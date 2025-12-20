const HEARTBEAT_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 7000;

let ownerTabId = null;
const tabs = new Map(); // tabId -> { port, lastSeen, pingIntervalId }

function postToTab(tabId, message) {
    const entry = tabs.get(tabId);
    if (!entry || !entry.port) return;
    try {
        entry.port.postMessage(message);
    } catch (e) {}
}

function broadcastStatus() {
    for (const [tabId, entry] of tabs.entries()) {
        try {
            entry.port.postMessage({
                type: 'ownership-status',
                isOwner: tabId === ownerTabId,
                ownerTabId
            });
        } catch (e) {}
    }
}

function pickNextOwner() {
    const first = tabs.keys().next();
    return first && !first.done ? first.value : null;
}

function setOwner(tabId) {
    ownerTabId = tabId;
    if (ownerTabId) {
        postToTab(ownerTabId, { type: 'ownership-granted', isOwner: true, ownerTabId });
        for (const otherTabId of tabs.keys()) {
            if (otherTabId !== ownerTabId) {
                postToTab(otherTabId, { type: 'ownership-denied', isOwner: false, ownerTabId });
            }
        }
    }
    broadcastStatus();
}

function removeTab(tabId) {
    const entry = tabs.get(tabId);
    if (!entry) return;
    if (entry.pingIntervalId) {
        clearInterval(entry.pingIntervalId);
    }
    tabs.delete(tabId);

    if (ownerTabId === tabId) {
        ownerTabId = null;
        const nextOwner = pickNextOwner();
        if (nextOwner) {
            setOwner(nextOwner);
        } else {
            broadcastStatus();
        }
    } else {
        broadcastStatus();
    }
}

setInterval(() => {
    const now = Date.now();
    for (const [tabId, entry] of tabs.entries()) {
        if (!entry.lastSeen || now - entry.lastSeen > HEARTBEAT_TIMEOUT) {
            removeTab(tabId);
        }
    }

    if (!ownerTabId && tabs.size > 0) {
        const nextOwner = pickNextOwner();
        if (nextOwner) {
            setOwner(nextOwner);
        }
    }
}, 1000);

// Handle port connections (for SharedWorker)
self.onconnect = function(event) {
    const port = event.ports[0];
    port.start();

    port.onmessage = function(event) {
        const { type, tabId, timestamp } = event.data || {};

        switch (type) {
            case 'init': {
                if (!tabId) return;

                if (tabs.has(tabId)) {
                    removeTab(tabId);
                }

                const pingIntervalId = setInterval(() => {
                    try {
                        port.postMessage({ type: 'heartbeat-request' });
                    } catch (e) {}
                }, HEARTBEAT_INTERVAL);

                tabs.set(tabId, {
                    port,
                    lastSeen: Date.now(),
                    pingIntervalId
                });

                if (!ownerTabId) {
                    setOwner(tabId);
                } else {
                    postToTab(tabId, { type: 'ownership-denied', isOwner: false, ownerTabId });
                    broadcastStatus();
                }
                break;
            }
            case 'heartbeat': {
                if (!tabId) return;
                const entry = tabs.get(tabId);
                if (!entry) return;
                entry.lastSeen = typeof timestamp === 'number' ? timestamp : Date.now();
                break;
            }
            case 'release':
            case 'disconnect': {
                if (!tabId) return;
                removeTab(tabId);
                break;
            }
            case 'check-ownership': {
                if (!tabId) return;
                postToTab(tabId, {
                    type: 'ownership-status',
                    isOwner: tabId === ownerTabId,
                    ownerTabId
                });
                break;
            }
        }
    };
};
