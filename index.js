const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const channelSecret = process.env.LINE_CHANNEL_SECRET;

// ✅ MessagingApiClient を使う
const client = new line.messagingApi.MessagingApiClient({ channelAccessToken });

// ✅ 署名検証 middleware は channelSecret
app.post("/webhook", line.middleware({ channelSecret }), async (req, res) => {
  // 先に200（タイムアウト回避）
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    console.log("events length:", events.length);

    for (const event of events) {
      console.log("event.type:", event.type);
      console.log("replyToken:", event.replyToken);

      if (event.type === "message" && event.message?.type === "text") {
        // ✅ MessagingApiClient の正しい呼び方
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: `受信OK: ${event.message.text}`,
            },
          ],
        });
        console.log("reply done");
      }
    }
  } catch (err) {
    console.error("handler error status:", err?.status);
    console.error("handler error body:", err?.body);
    console.error("handler error raw:", err);
  }
});

app.get("/", (req, res) =>
  res.status(200).send("LINE webhook server is running.")
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
