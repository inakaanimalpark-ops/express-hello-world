const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

app.get("/", (req, res) => {
  res.status(200).send("LINE webhook server is running.");
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];
    await Promise.all(
      events.map(async (event) => {
        if (event.type !== "message" || event.message.type !== "text") return;
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `受信OK: ${event.message.text}`,
        });
      })
    );
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
