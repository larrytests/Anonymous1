import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "socket.io-client"; // Ensure Socket.io client is included

createRoot(document.getElementById("root")!).render(<App />);