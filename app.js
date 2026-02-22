// main.js 加强版 - 加日志 + ping 保活

const UUID = "22aa7081-7880-42f9-9118-7fa950354cdb";
const DOMAIN = "testjs.growinghacker.deno.net";

const uuidHex = UUID.replace(/-/g, "");
const uuidBytes = new Uint8Array(16);
for (let i = 0; i < 16; i++) {
  uuidBytes[i] = parseInt(uuidHex.slice(i*2, i*2+2), 16);
}

Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("Hello, World-YGkkk\n隧道运行中", { status: 200 });
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
  let pingTimer = null;

  ws.onmessage = async (e) => {
    try {
      const msg = new Uint8Array(e.data);
      console.log(`收到客户端消息，长度: ${msg.length}`);

      if (!tcp) {  // 握手
        if (msg.length < 18 || !msg.slice(1, 17).every((v, i) => v === uuidBytes[i])) {
          console.log("UUID 不匹配，关闭");
          return ws.close();
        }

        let pos = msg[17] + 19;
        const port = (msg[pos] << 8) | msg[pos + 1];
        pos += 2;
        const atyp = msg[pos++];
        let host = "";

        if (atyp === 1) {
          host = `${msg[pos]}.${msg[pos+1]}.${msg[pos+2]}.${msg[pos+3]}`;
          pos += 4;
        } else if (atyp === 2) {
          const len = msg[pos++];
          host = new TextDecoder().decode(msg.slice(pos, pos + len));
          pos += len;
        } else if (atyp === 3) {
          // IPv6 简化处理
          host = "IPv6-not-supported-in-test";
        }

        ws.send(new Uint8Array([msg[0], 0]));
        console.log(`握手成功，回 [${msg[0]}, 0]，目标: ${host}:${port}`);

        tcp = await Deno.connect({ hostname: host, port });
        console.log("TCP 连接建立成功");

        if (pos < msg.length) {
          await tcp.write(msg.slice(pos));
          console.log("已写入 early data");
        }

        // 启动 TCP → WS
        (async () => {
          try {
            for await (const chunk of Deno.iter(tcp)) {
              console.log(`TCP 收到数据，长度: ${chunk.length}`);
              if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
            }
          } catch (err) {
            console.error("TCP 读取错误:", err);
          } finally {
            ws.close();
          }
        })();

        // 每 30s ping 保活（防止 Deno Deploy 杀连接）
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(new Uint8Array([0x89, 0]));  // WebSocket ping frame
            console.log("发送 ping 保活");
          }
        }, 30000);

      } else {
        console.log("转发客户端数据到 TCP，长度:", msg.length);
        await tcp.write(msg);
      }
    } catch (err) {
      console.error("WS 处理错误:", err);
      ws.close();
    }
  };

  ws.onclose = () => {
    console.log("WS 关闭");
    if (tcp) tcp.close().catch(() => {});
    if (pingTimer) clearInterval(pingTimer);
  };

  ws.onerror = (err) => console.error("WS 错误:", err);
}

console.log("服务器启动完成");
