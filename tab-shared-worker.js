let ports = [];
let ownerPortId = null;

function broadcast(message) {
  ports.forEach(({ port }) => {
    try { port.postMessage(message); } catch (e) {}
  });
}

onconnect = function (event) {
  const port = event.ports[0];
  const id = Math.random().toString(36).slice(2);
  ports.push({ id, port });
  port.start();

  port.postMessage({ type: 'connected', id });
  port.postMessage({ type: 'ownerStatus', ownerPortId });

  port.onmessage = function (ev) {
    const msg = ev.data || {};
    if (!msg || !msg.type) return;

    if (msg.type === 'claimOwner') {
      ownerPortId = msg.id;
      broadcast({ type: 'ownerChanged', id: ownerPortId });
    } else if (msg.type === 'releaseOwner') {
      if (ownerPortId === msg.id) {
        ownerPortId = null;
        broadcast({ type: 'ownerReleased' });
      }
    } else if (msg.type === 'disconnect') {
      ports = ports.filter(p => p.port !== port);
      if (ownerPortId === msg.id) {
        ownerPortId = null;
        broadcast({ type: 'ownerReleased' });
      }
    }
  };
};
