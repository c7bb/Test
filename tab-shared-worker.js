// Tab Shared Worker - Manages tab ownership using Broadcast Channel API and Web Locks API
const TAB_LOCK_NAME = 'dcrefbot-tab-lock';
const BROADCAST_CHANNEL_NAME = 'dcrefbot-tab-broadcast';
const HEARTBEAT_INTERVAL = 2000; // 2 seconds
const HEARTBEAT_TIMEOUT = 5000; // 5 seconds - if no heartbeat, tab is considered dead

let ownerTabId = null;
let ownerHeartbeat = null;
let heartbeatInterval = null;
const connectedTabs = new Map(); // Map of tabId -> lastHeartbeat timestamp

// Broadcast Channel for cross-tab communication
let broadcastChannel = null;

try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    
    broadcastChannel.onmessage = (event) => {
        const { type, tabId, timestamp } = event.data;
        
        switch (type) {
            case 'heartbeat':
                if (tabId) {
                    connectedTabs.set(tabId, timestamp);
                    // If we're the owner and received a heartbeat, acknowledge it
                    if (ownerTabId === self.name) {
                        broadcastChannel.postMessage({
                            type: 'heartbeat-ack',
                            ownerTabId: ownerTabId,
                            timestamp: Date.now()
                        });
                    }
                }
                break;
                
            case 'request-ownership':
                // If no owner exists, grant ownership
                if (!ownerTabId) {
                    ownerTabId = tabId;
                    ownerHeartbeat = Date.now();
                    broadcastChannel.postMessage({
                        type: 'ownership-granted',
                        ownerTabId: tabId,
                        timestamp: Date.now()
                    });
                    startHeartbeatCheck();
                } else if (ownerTabId === self.name) {
                    // We're the owner, respond
                    broadcastChannel.postMessage({
                        type: 'ownership-status',
                        ownerTabId: ownerTabId,
                        timestamp: Date.now()
                    });
                }
                break;
                
            case 'release-ownership':
                if (ownerTabId === tabId) {
                    ownerTabId = null;
                    ownerHeartbeat = null;
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                    broadcastChannel.postMessage({
                        type: 'ownership-released',
                        timestamp: Date.now()
                    });
                }
                break;
                
            case 'ownership-granted':
                if (tabId && !ownerTabId) {
                    ownerTabId = tabId;
                    ownerHeartbeat = Date.now();
                }
                break;
                
            case 'ownership-status':
                if (tabId && !ownerTabId) {
                    ownerTabId = tabId;
                    ownerHeartbeat = Date.now();
                }
                break;
                
            case 'heartbeat-ack':
                if (tabId === ownerTabId) {
                    ownerHeartbeat = Date.now();
                }
                break;
        }
    };
} catch (e) {
    console.error('BroadcastChannel not supported:', e);
}

// Heartbeat check to detect dead owner tabs
function startHeartbeatCheck() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }
    
    heartbeatInterval = setInterval(() => {
        const now = Date.now();
        
        // Check if owner is still alive
        if (ownerTabId && ownerHeartbeat) {
            if (now - ownerHeartbeat > HEARTBEAT_TIMEOUT) {
                // Owner is dead, release ownership
                console.log('Owner tab died, releasing ownership');
                ownerTabId = null;
                ownerHeartbeat = null;
                broadcastChannel?.postMessage({
                    type: 'ownership-released',
                    timestamp: now
                });
            }
        }
        
        // Clean up dead tabs from connectedTabs
        for (const [tabId, lastHeartbeat] of connectedTabs.entries()) {
            if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
                connectedTabs.delete(tabId);
            }
        }
    }, 1000);
}

// Handle port connections (for SharedWorker)
self.onconnect = function(event) {
    const port = event.ports[0];
    const tabId = self.name || `tab-${Date.now()}-${Math.random()}`;
    
    port.onmessage = function(event) {
        const { type, data } = event.data;
        
        switch (type) {
            case 'init':
                // Tab is initializing, try to get ownership
                if (!ownerTabId) {
                    ownerTabId = tabId;
                    ownerHeartbeat = Date.now();
                    startHeartbeatCheck();
                    port.postMessage({
                        type: 'ownership-granted',
                        isOwner: true,
                        ownerTabId: tabId
                    });
                } else {
                    port.postMessage({
                        type: 'ownership-denied',
                        isOwner: false,
                        ownerTabId: ownerTabId
                    });
                }
                
                // Also broadcast via BroadcastChannel
                if (broadcastChannel) {
                    broadcastChannel.postMessage({
                        type: 'request-ownership',
                        tabId: tabId,
                        timestamp: Date.now()
                    });
                }
                break;
                
            case 'heartbeat':
                if (ownerTabId === tabId) {
                    ownerHeartbeat = Date.now();
                    connectedTabs.set(tabId, Date.now());
                    
                    // Broadcast heartbeat
                    if (broadcastChannel) {
                        broadcastChannel.postMessage({
                            type: 'heartbeat',
                            tabId: tabId,
                            timestamp: Date.now()
                        });
                    }
                } else {
                    connectedTabs.set(tabId, Date.now());
                    
                    // Broadcast heartbeat
                    if (broadcastChannel) {
                        broadcastChannel.postMessage({
                            type: 'heartbeat',
                            tabId: tabId,
                            timestamp: Date.now()
                        });
                    }
                }
                break;
                
            case 'release':
                if (ownerTabId === tabId) {
                    ownerTabId = null;
                    ownerHeartbeat = null;
                    if (heartbeatInterval) {
                        clearInterval(heartbeatInterval);
                        heartbeatInterval = null;
                    }
                    
                    if (broadcastChannel) {
                        broadcastChannel.postMessage({
                            type: 'release-ownership',
                            tabId: tabId,
                            timestamp: Date.now()
                        });
                    }
                }
                break;
                
            case 'check-ownership':
                port.postMessage({
                    type: 'ownership-status',
                    isOwner: ownerTabId === tabId,
                    ownerTabId: ownerTabId
                });
                break;
        }
    };
    
    // Start heartbeat for this tab
    setInterval(() => {
        port.postMessage({
            type: 'heartbeat-request'
        });
    }, HEARTBEAT_INTERVAL);
};

// Fallback: If BroadcastChannel is available but SharedWorker isn't, we can still work
if (broadcastChannel && !self.onconnect) {
    // This is a fallback mode - we'll use BroadcastChannel only
    console.log('SharedWorker not available, using BroadcastChannel only');
}
