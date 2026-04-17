const crypto = require("crypto");
const https = require("https");

const pw = crypto.createHash("md5").update("dinhvuhao5").digest("hex");

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "Origin": "https://lc79b.bet", "User-Agent": "Mozilla/5.0" } }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on("error", reject);
  });
}

function httpPost(urlStr, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr), "Origin": "https://lc79b.bet", "User-Agent": "Mozilla/5.0" }
    }, (res) => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on("error", reject); req.write(bodyStr); req.end();
  });
}

async function main() {
  // Bước 1
  const pre = await httpGet(`https://apifo88daigia.tele68.com/api?c=3&un=dinhhaor150&pw=${pw}&cp=R&cl=R&pf=web&at=`);
  console.log("Step1 accessToken:", pre.accessToken);

  // Bước 2
  const login = await httpPost("https://wlb.tele68.com/v1/lobby/auth/login?cp=R&cl=R&pf=web&at=", {
    nickName: "vuhao212",
    accessToken: pre.accessToken
  });
  console.log("Step2 full response:", JSON.stringify(login).substring(0, 500));
}

main().catch(console.error);
