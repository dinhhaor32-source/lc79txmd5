const express = require("express");
const path = require("path");
const fs = require("fs");
const { connect, getResults, getNextSession, getCurrentTick, updateToken, getToken, setPushSSE } = require("./tele68-client");
const { recordPrediction, getPredictions } = require("./data-collector");

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory prediction log (không cần file/volume)
let predictionLog = [];

// ============================================================
// CORS + JSON
// ============================================================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());

// ============================================================
// STATIC
// ============================================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "nha_cai_psychology.html"));
});

app.get("/psychology", (req, res) => {
  res.sendFile(path.join(__dirname, "nha_cai_psychology.html"));
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  const token = getToken();
  let tokenStatus = "no_token", tokenExpiry = null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    const now = Math.floor(Date.now() / 1000);
    const remaining = payload.exp - now;
    tokenStatus = remaining > 0 ? "ok" : "expired";
    tokenExpiry = remaining > 0 ? `${Math.floor(remaining / 60)} phút` : "Đã hết hạn";
  } catch {}

  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()) + "s",
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    token: tokenStatus,
    tokenExpiry,
    connected: !!getCurrentTick(),
    currentSession: getCurrentTick()?.id || null,
    resultsInMemory: getResults().length,
    predictionLogCount: predictionLog.length,
    sseClients: sseClients.length,
    time: new Date().toISOString()
  });
});

// ============================================================
// RESULT / HISTORY
// ============================================================
app.get("/result", (req, res) => {
  const results = getResults();
  const next = getNextSession();
  res.json({
    status: "ok",
    next: next ? { sessionId: next.id, md5: next.md5 } : null,
    latest: results.length ? results[0] : null
  });
});

app.get("/history", (req, res) => {
  const results = getResults();
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json({
    status: "ok",
    count: results.length,
    data: results.slice(0, limit)
  });
});

app.get("/dulieumd5", (req, res) => {
  const results = getResults();
  res.json({
    status: "ok",
    count: results.length,
    data: results.map(r => ({ phien: r.sessionId, md5: r.md5, md5Raw: r.md5Raw, ketqua: r.result }))
  });
});

// ============================================================
// SSE — live tick
// ============================================================
const sseClients = [];

app.get("/live", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25000);

  sseClients.push(res);
  req.on("close", () => {
    clearInterval(heartbeat);
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  });
});

function pushSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try { sseClients[i].write(msg); }
    catch { sseClients.splice(i, 1); }
  }
}
setPushSSE(pushSSE);

app.get("/live-snapshot", (req, res) => {
  res.json({
    tick: getCurrentTick(),
    history: getResults().slice(0, 30),
    predictions: getPredictions()
  });
});

// ============================================================
// TOKEN
// ============================================================
app.post("/update-token", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ status: "error", message: "Thiếu token" });
  updateToken(token);
  res.json({ status: "ok", message: "Token đã được cập nhật" });
});

app.get("/token-status", (req, res) => {
  const token = getToken();
  if (!token) return res.json({ status: "no_token" });
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    const now = Math.floor(Date.now() / 1000);
    const remaining = payload.exp - now;
    res.json({
      status: remaining > 0 ? "ok" : "expired",
      expiresIn: remaining > 0 ? `${Math.floor(remaining / 60)} phút` : "Đã hết hạn",
      username: payload.username || payload.nickName
    });
  } catch { res.json({ status: "invalid_token" }); }
});

// ============================================================
// PREDICTION LOG — in-memory
// ============================================================
app.post("/save-prediction", (req, res) => {
  const entry = req.body;
  if (!entry || !entry.sessionId) return res.status(400).json({ status: "error" });
  // Tránh duplicate
  if (predictionLog.find(p => p.sessionId === entry.sessionId))
    return res.json({ status: "duplicate" });
  predictionLog.unshift({ ...entry, savedAt: new Date().toISOString() });
  if (predictionLog.length > 500) predictionLog.pop();
  res.json({ status: "ok" });
});

app.get("/predictions-log", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json({ status: "ok", count: predictionLog.length, data: predictionLog.slice(0, limit) });
});

app.delete("/predictions-log", (req, res) => {
  predictionLog = [];
  res.json({ status: "ok", message: "Đã xóa toàn bộ" });
});

// ============================================================
// ANALYZE PREDICTIONS — kết luận AI
// ============================================================
app.get("/analyze-predictions", (req, res) => {
  const judged = predictionLog.filter(p => p.correct !== null && p.correct !== undefined);
  if (judged.length < 10) return res.json({ status: "not_enough", total: predictionLog.length, judged: judged.length, message: `Cần ít nhất 10 phiên, hiện có ${judged.length}` });

  const totalCorrect = judged.filter(p => p.correct).length;
  const overallRate = (totalCorrect / judged.length * 100).toFixed(1);

  const mkGroup = (groups) => groups.map(g => {
    const group = judged.filter(g.filter);
    if (!group.length) return { label: g.label, count: 0, correct: 0, rate: null };
    const correct = group.filter(p => p.correct).length;
    return { label: g.label, count: group.length, correct, rate: +(correct / group.length * 100).toFixed(1) };
  });

  const byLockTime = mkGroup([
    { label: "Sớm (≥8s)",   filter: p => p.lockSubTick >= 8 },
    { label: "Vừa (5-7s)",  filter: p => p.lockSubTick >= 5 && p.lockSubTick < 8 },
    { label: "Muộn (3-4s)", filter: p => p.lockSubTick >= 3 && p.lockSubTick < 5 },
  ]);
  const byConfidence = mkGroup([
    { label: "Rất mạnh (≥75%)", filter: p => p.confidence >= 0.75 },
    { label: "Mạnh (62-74%)",   filter: p => p.confidence >= 0.62 && p.confidence < 0.75 },
    { label: "Vừa (55-61%)",    filter: p => p.confidence >= 0.55 && p.confidence < 0.62 },
  ]);
  const byMoneyImbalance = mkGroup([
    { label: "Lệch rất mạnh (≥70%)", filter: p => Math.max(p.taiPct||0, p.xiuPct||0) >= 70 },
    { label: "Lệch mạnh (60-69%)",   filter: p => Math.max(p.taiPct||0, p.xiuPct||0) >= 60 && Math.max(p.taiPct||0, p.xiuPct||0) < 70 },
    { label: "Lệch vừa (55-59%)",    filter: p => Math.max(p.taiPct||0, p.xiuPct||0) >= 55 && Math.max(p.taiPct||0, p.xiuPct||0) < 60 },
    { label: "Cân bằng (<55%)",      filter: p => Math.max(p.taiPct||0, p.xiuPct||0) < 55 },
  ]);

  const conclusions = [];
  const validLock = byLockTime.filter(g => g.count >= 5);
  if (validLock.length >= 2) {
    const best = validLock.reduce((a, b) => a.rate > b.rate ? a : b);
    const worst = validLock.reduce((a, b) => a.rate < b.rate ? a : b);
    conclusions.push(best.rate - worst.rate >= 5
      ? `⏱ THỜI ĐIỂM KHÓA: "${best.label}" tốt nhất (${best.rate}%), hơn "${worst.label}" (${worst.rate}%) ${(best.rate - worst.rate).toFixed(1)}%.`
      : `⏱ THỜI ĐIỂM KHÓA: Chênh lệch không đáng kể (${worst.rate}% - ${best.rate}%).`);
  }
  const validConf = byConfidence.filter(g => g.count >= 5);
  if (validConf.length >= 2) {
    const high = validConf[0], low = validConf[validConf.length - 1];
    if (high && low && high.rate - low.rate >= 8)
      conclusions.push(`📊 CONFIDENCE: Tín hiệu mạnh đúng ${high.rate}% vs ${low.rate}% — bỏ qua khi conf thấp.`);
  }
  const validMoney = byMoneyImbalance.filter(g => g.count >= 5);
  if (validMoney.length >= 2) {
    const best = validMoney.reduce((a, b) => a.rate > b.rate ? a : b);
    conclusions.push(`💰 DÒNG TIỀN: "${best.label}" cho tỉ lệ đúng cao nhất (${best.rate}%).`);
  }
  conclusions.push(+overallRate >= 60
    ? `✅ TỔNG QUAN: Thuật toán tốt — ${overallRate}% trên ${judged.length} phiên.`
    : +overallRate >= 50
    ? `⚠️ TỔNG QUAN: Trung bình — ${overallRate}% trên ${judged.length} phiên.`
    : `❌ TỔNG QUAN: Chưa hiệu quả — ${overallRate}% trên ${judged.length} phiên.`);

  res.json({ status: "ok", summary: { total: predictionLog.length, judged: judged.length, correct: totalCorrect, overallRate: +overallRate }, byLockTime, byConfidence, byMoneyImbalance, conclusions, generatedAt: new Date().toISOString() });
});

// ============================================================
// ANALYZE SESSIONS
// ============================================================
app.get("/analyze", (req, res) => {
  const results = getResults();
  if (results.length < 5) return res.json({ status: "not_enough", total: results.length });
  const taiCount = results.filter(r => r.result === "TAI").length;
  res.json({
    status: "ok",
    total: results.length,
    taiRate: +(taiCount / results.length * 100).toFixed(1),
    xiuRate: +((results.length - taiCount) / results.length * 100).toFixed(1)
  });
});

// ============================================================
// START
// ============================================================
// ============================================================
// PREDICTION — dự đoán phiên hiện tại dựa trên tick mới nhất
// ============================================================
app.get("/prediction", (req, res) => {
  const tick = getCurrentTick();
  if (!tick || !tick.data) return res.json({ status: "no_data", message: "Chưa có tick data" });

  const taiAmt = tick.data.totalAmountPerType?.TAI || 0;
  const xiuAmt = tick.data.totalAmountPerType?.XIU || 0;
  const taiUsers = tick.data.totalUsersPerType?.TAI || 0;
  const xiuUsers = tick.data.totalUsersPerType?.XIU || 0;
  const totalAmt = taiAmt + xiuAmt;
  if (totalAmt === 0) return res.json({ status: "no_data", message: "Chưa có tiền cược" });

  const taiPct = taiAmt / totalAmt * 100;
  const xiuPct = 100 - taiPct;
  const majorPct = Math.max(taiPct, xiuPct);
  const majorSide = taiPct > xiuPct ? "TAI" : "XIU";
  const minorSide = majorSide === "TAI" ? "XIU" : "TAI";

  // Zone-based v3
  let prediction = "SKIP", confidence = 0.5, reason = "";

  if (majorPct >= 60 && majorPct < 65) {
    prediction = majorSide;
    confidence = 0.64;
    reason = `ZONE 60-64%: theo bên nhiều tiền (${majorSide} ${majorPct.toFixed(1)}%)`;
  } else if (majorPct >= 65 || majorPct < 45) {
    // Tính score đơn giản
    const imbalance = Math.abs(taiPct - xiuPct) / 100;
    const mp_score = majorPct > 75 ? 0.90 : majorPct > 67 ? 0.75 : majorPct > 65 ? 0.55 : 0.35;
    const finalScore = Math.min(0.85, 0.50 + mp_score * 0.40);
    if (finalScore > 0.55) {
      prediction = minorSide;
      confidence = +finalScore.toFixed(3);
      reason = `Lệch ${majorPct.toFixed(1)}%: ngược bên nhiều tiền (${majorSide})`;
    } else {
      prediction = "SKIP";
      reason = "Tín hiệu không rõ";
    }
  } else {
    prediction = "SKIP";
    reason = `Vùng nhiễu ${majorPct.toFixed(1)}% (45-65%)`;
  }

  res.json({
    status: "ok",
    sessionId: tick.id,
    tick: tick.tick,
    subTick: tick.subTick,
    state: tick.state,
    prediction,
    confidence: +(confidence * 100).toFixed(1),
    reason,
    data: {
      taiPct: +taiPct.toFixed(2),
      xiuPct: +xiuPct.toFixed(2),
      taiAmt,
      xiuAmt,
      totalAmt,
      taiUsers,
      xiuUsers,
      majorSide,
      majorPct: +majorPct.toFixed(2)
    },
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[API] Running on port ${PORT}`);
  connect();
});
