// main.js   —— 纯 JavaScript 版（甬哥 VLESS-WS 隧道，Deno Deploy 专用）

const UUID = "22aa7081-7880-42f9-9118-7fa950354cdb";
const DOMAIN = "testjs.growinghacker.deno.net";

const uuidHex = UUID.replace(/-/g, "");
const uuidBytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
  uuidBytes[i] = parseInt(uuidHex.slice(i*2, i*2+2), 16);
}

console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
console.log("甬哥Github项目 ：github.com/yonggekkk");
console.log("Deno Deploy 一键 VLESS-WS 隧道（纯 JS 版）");
console.log("UUID:", UUID);
console.log("域名:", DOMAIN);
console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");

Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("Hello, World-YGkkk\nDeno Deploy VLESS-WS 隧道运行中", { status: 200 });
    }
    if (url.pathname === `/${UUID}` || url.pathname === "/sub") {
      const vless = `vless://${UUID}@${DOMAIN}:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#Deno-Vl-ws-tls`;
      return new Response(vless + "\n", { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  handleWS(socket);
  return response;
});

function handleWS(ws) {
  let tcp = null;

  ws.onmessage = async (e) => {
    try {
      const msg = new Uint8Array(e.data);

      if (!tcp) {  // 第一次消息：握手
        if (msg.length < 18 || !msg.slice(1, 17).every((v, i) => v === uuidBytes[i])) {
          return ws.close();
        }

        let pos = msg[17] + 19;
        const port = (msg[pos] << 8) | msg[pos + 1];
        pos += 2;
        const atyp = msg[pos++];
        let host = "";

        if (atyp === 1) {  // IPv4
          host = `${msg[pos]}.${msg[pos+1]}.${msg[pos+2]}.${msg[pos+3]}`;
          pos += 4;
        } else if (atyp === 3) {  // IPv6
          host = Array.from(msg.slice(pos, pos+16))
            .reduce((s, b, i) => i%2 ? s + b.toString(16).padStart(2,'0') : s + b.toString(16).padStart(2,'0') + ":", "")
            .slice(0, -1);
          pos += 16;
        } else if (atyp === 2) {  // 域名
          const len = msg[pos++];
          host = new TextDecoder().decode(msg.slice(pos, pos + len));
          pos += len;
        }

        ws.send(new Uint8Array([msg[0], 0]));  // 成功回复 [5, 0]

        tcp = await Deno.connect({ hostname: host, port });
        if (pos < msg.length) await tcp.write(msg.slice(pos));

        console.log(`隧道建立 → ${host}:${port}`);

        // TCP → WS 转发
        (async () => {
          for await (const chunk of Deno.iter(tcp)) {
            if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
          }
          ws.close();
        })();
      } else {
        // 已握手，后续数据直接转发
        await tcp.write(msg);
      }
    } catch (err) {
      console.error("错误:", err);
      ws.close();
    }
  };

  ws.onclose = () => { 
    if (tcp) tcp.close().catch(() => {}); 
  };
}

console.log("✅ 纯 JS 隧道服务器已启动");
