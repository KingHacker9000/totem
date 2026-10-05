import net from "node:net";

// Reads one normalized event from stdin. Never runs a producer-supplied command.
try {
  let bytes = 0,
    chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("event too large");
    chunks.push(chunk);
  }
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const socket = net.createConnection(
    process.env.TOTEM_COMPANION_EVENT_SOCKET ||
      "/run/totem-companion/events.sock",
  );
  socket.setEncoding("utf8");
  const result = await new Promise((resolve, reject) => {
    let response = "";
    socket.setTimeout(10000, () =>
      socket.destroy(new Error("event acknowledgement timeout")),
    );
    socket.on("connect", () => socket.write(`${JSON.stringify(event)}\n`));
    socket.on("data", (chunk) => {
      response += chunk;
      if (Buffer.byteLength(response) > 8192)
        socket.destroy(new Error("invalid event acknowledgement"));
    });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        resolve(JSON.parse(response));
      } catch {
        reject(new Error("invalid event acknowledgement"));
      }
    });
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Event not published: ${error.message}\n`);
  process.exitCode = 1;
}
