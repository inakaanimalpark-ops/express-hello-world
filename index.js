const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// Render疎通確認
app.get("/", (req, res) => res.status(200).send("LINE webhook server is running."));

// Webhook
app.post(
  "/webhook",
  (req, res, next) => {
    console.log(">>> HIT /webhook (before signature check)");
    next();
  },
  line.middleware(config),
  async (req, res) => {
    // LINEには即200を返す（タイムアウト回避）
    res.status(200).send("OK");

    try {
      const events = req.body?.events || [];
      console.log("events length:", events.length);

      for (const event of events) {
        if (event.type === "message" && event.message?.type === "text") {
          await client.replyMessage(event.replyToken, [
            { type: "text", text: `受信OK: ${event.message.text}` },
          ]);
        }
      }
    } catch (err) {
      console.error("handler error:", err?.body || err);
    }
  }
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
