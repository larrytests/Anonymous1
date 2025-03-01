// Simple WebSocket test utility
export function testWebSocketConnection() {
  console.log("Starting WebSocket connection test...");

  const ws = new WebSocket(`ws://${window.location.host}/ws`);

  ws.onopen = () => {
    console.log("WebSocket connection established successfully");
    console.log("Sending test message...");

    // Send a test message
    ws.send(
      JSON.stringify({
        type: "user_connected",
        senderId: "test-user-" + Date.now(),
        timestamp: new Date().toISOString(),
      }),
    );
  };

  ws.onmessage = (event) => {
    console.log("Received message:", JSON.parse(event.data));
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  ws.onclose = (event) => {
    console.log("WebSocket closed:", {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
  };

  return ws; // Return the WebSocket instance for further testing
}

// Make it available globally for console testing
(window as any).testWebSocket = testWebSocketConnection;
