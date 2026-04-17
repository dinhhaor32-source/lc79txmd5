const WebSocket = require("ws");
const crypto = require("crypto");
const https = require("https");

const WS_URL = "wss://wtxmd52.tele68.com/txmd5/?EIO=4&transport=websocket";
const USERNAME = "dinhhaor150";
const PASSWORD = "dinhvuhao5";

function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "Origin": "https://lc79b.bet",
        "Referer": "https://lc79b.bet/",
        "User-Agent": "Mozilla/5.0"
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on("error", reject);
  });
}

function httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyStr),
        "Origin": "https://lc79b.bet",
        "Referer": "https://lc79b.bet/",
        "User-Agent": "Mozilla/5.0"
      }
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on("error", reject);
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Login lấy token
  const pwMd5 = md5(PASSWORD);
  console.log("[AUTH] Đang đăng nhập...");
  const pre = await httpGet(`https://apifo88daigia.tele68.com/api?c=3&un=${USERNAME}&pw=${pwMd5}&cp=R&cl=R&pf=web&at=`);
  const accessToken = pre.accessToken || pre.data?.accessToken;
  const nickName = pre.nickName || pre.data?.nickName;
  console.log("[AUTH] accessToken:", accessToken);

  const loginResp = await httpPost("https://wlb.tele68.com/v1/lobby/auth/login?cp=R&cl=R&pf=web&at=", {
    nickName: nickName || "vuhao212",
    accessToken
  });
  const token = loginResp.token || loginResp.data?.token;
  console.log("[AUTH] JWT token:", token ? token.substring(0, 40) + "..." : "KHÔNG LẤY ĐƯỢC");

  // Kết nối WebSocket và log RAW toàn bộ
  const ws = new WebSocket(WS_URL, {
    headers: {
      "Origin": "https://lc79b.bet",
      "Referer": "https://lc79b.bet/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  let msgCount = 0;

  ws.on("open", () => console.log("\n[WS] Đã kết nối!\n"));

  ws.on("message", (data) => {
    msgCount++;
    const txt = data.toString();
    console.log(`\n--- MSG #${msgCount} ---`);
    console.log(txt);

    // Tự động gửi auth sau khi nhận handshake
    if (txt.startsWith('0{')) {
      console.log(`[WS] >> Gửi auth token...`);
      ws.send(`40/txmd5,{"token":"${token}"}`);
    }
    if (txt === '2') {
      ws.send('3');
    }
  });

  ws.on("error", (err) => console.error("[WS ERROR]", err.message));
  ws.on("close", (code) => console.log(`[WS] Đóng kết nối, code: ${code}`));
}

main().catch(console.error);
