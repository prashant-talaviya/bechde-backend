import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import connectDB from "./config/database";
import { startNotificationWorker } from './services/notification-worker';
import { attachChatEvents } from './services/chat-events';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Start accepting requests only after MongoDB is connected.
    await connectDB();
    startNotificationWorker();

    const server = app.listen(PORT, () => {
      console.log(`BechDe API running on port ${PORT}`);
    });
    attachChatEvents(server);
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
