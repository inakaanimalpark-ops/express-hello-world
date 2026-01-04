const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// 重要：/webhook で line.middleware を先に通す（署名検証）
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    console.log("events length:", events.length);

    for (const event of events) {
      if (event.type === "message" && event.message && event.message.type === "text") {
        await client.replyMessage(event.replyToken, {
  messages: [
    {
      type: "text",
      text: `受信OK: ${event.message.text}`,
    },
  ],
});

      }
    }

    res.status(200).send("OK");
  } catch (err) {
  console.error("reply failed:", err);
  res.status(200).send("OK");
}

});

// Render疎通確認
app.get("/", (req, res) => res.send("LINE webhook server is running."));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
