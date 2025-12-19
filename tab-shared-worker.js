let ports = [];
let ownerPortId = null;

function broadcast(message) {
  ports.forEach(({ port }) => {
    try { port.postMessage(message); } catch (e) {}
  });
}

function setOwner(newOwnerId) {
  ownerPortId = newOwnerId || null;
  if (ownerPortId) {
    broadcast({ type: 'ownerChanged', id: ownerPortId });
  } else {
    broadcast({ type: 'ownerReleased' });
  }
}

onconnect = function (event) {
  const port = event.ports[0];
  const id = Math.random().toString(36).slice(2);
  ports.push({ id, port });
  port.start();

  port.postMessage({ type: 'connected', id });
  port.postMessage({ type: 'ownerStatus', ownerPortId });
  if (!ownerPortId) {
    setOwner(id);
  }

  port.onmessage = function (ev) {
    const msg = ev.data || {};
    if (!msg || !msg.type) return;

    if (msg.type === 'claimOwner') {
      const exists = ports.some(p => p.id === msg.id);
      if (exists) {
        setOwner(msg.id);
      }
    } else if (msg.type === 'releaseOwner') {
      if (ownerPortId === msg.id) {
        const nextOwnerId = ports.find(p => p.id !== msg.id)?.id || null;
        setOwner(nextOwnerId);
      }
    } else if (msg.type === 'disconnect') {
      ports = ports.filter(p => p.port !== port);
      if (ownerPortId === msg.id) {
        const nextOwnerId = ports[0]?.id || null;
        setOwner(nextOwnerId);
      }
    }
  };
};
