const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

app.post(
  "/webhook",
  (req, res, next) => {
    console.log(">>> HIT /webhook (before signature check)");
    next();
  },
  line.middleware(config),
  async (req, res) => {
    res.status(200).send("OK");
    // ここから先は非同期でOK（返信処理など）
  }
);

  (async () => {
    try {
      for (const event of events) {
        if (event.type === "message" && event.message?.type === "text") {
          await client.replyMessage(event.replyToken, [
  {
    type: "text",
    text: `受信OK: ${event.message.text}`,
  },
]);

        }
      }
    } catch (err) {
      console.error("async handler error:", err?.body || err);
    }
  })();
});


    // ✅ ここで必ず200
    return res.status(200).send("OK");
  } catch (err) {
    console.error("reply failed:", err?.body || err);
    // ✅ 失敗しても200（LINE再送地獄回避）
    return res.status(200).send("OK");
  }
});

// Render疎通確認
app.get("/", (req, res) => res.status(200).send("LINE webhook server is running."));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
