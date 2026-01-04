const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

console.log("=== VER1 CODE ACTIVE 2026-01-04 ===");

const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
const channelAccessToken = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();

// ---- 超簡易DB（メモリ） ----
// Render再起動で消えます（今日はMVP優先）
const userStateMap = new Map();

function getUserId(event) {
  return event?.source?.userId || null;
}

function resetUser(userId) {
  userStateMap.set(userId, { step: "WAIT_GENDER", birth: {} });
}

function isValidBirth(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(`${s}T00:00:00`);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function daysInMonth(year, monthStr) {
  const m = Number(monthStr); // 1-12
  return new Date(year, m, 0).getDate();
}

// ---- LINE Reply API 直投げ（SDKの400問題回避） ----
async function reply(replyToken, messages) {
  const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });

  if (!resp.ok) {
    const bodyText = await resp.text();
    console.error("LINE Reply API failed:", resp.status, bodyText);
  }
}

// ---- Quick Replies ----
function quickReplyGender() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "男性", text: "男性" } },
      { type: "action", action: { type: "message", label: "女性", text: "女性" } },
      { type: "action", action: { type: "message", label: "その他", text: "その他" } },
    ],
  };
}

function quickReplyNext() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "次へ", text: "次へ" } },
      { type: "action", action: { type: "message", label: "最初から", text: "最初から" } },
    ],
  };
}

function quickReplyYearRange() {
  return {
    items: [
      { type: "action", action: { type: "message", label: "1970-79", text: "YRANGE:1970" } },
      { type: "action", action: { type: "message", label: "1980-89", text: "YRANGE:1980" } },
      { type: "action", action: { type: "message", label: "1990-99", text: "YRANGE:1990" } },
      { type: "action", action: { type: "message", label: "2000-09", text: "YRANGE:2000" } },
      { type: "action", action: { type: "message", label: "2010-19", text: "YRANGE:2010" } },
      { type: "action", action: { type: "message", label: "その他", text: "BIRTH_TEXT" } },
    ],
  };
}

function quickReplyYears(startYear) {
  const items = [];
  for (let y = startYear; y < startYear + 10; y++) {
    items.push({ type: "action", action: { type: "message", label: String(y), text: `Y:${y}` } });
  }
  items.push({ type: "action", action: { type: "message", label: "戻る", text: "BACK_YRANGE" } });
  return { items };
}

function quickReplyMonths() {
  const items = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    items.push({ type: "action", action: { type: "message", label: `${m}月`, text: `M:${mm}` } });
  }
  items.push({ type: "action", action: { type: "message", label: "戻る", text: "BACK_YEAR" } });
  return { items };
}

function quickReplyDays(maxDay) {
  const items = [];
  for (let d = 1; d <= Math.min(maxDay, 12); d++) {
    const dd = String(d).padStart(2, "0");
    items.push({ type: "action", action: { type: "message", label: String(d), text: `D:${dd}` } });
  }
  items.push({ type: "action", action: { type: "message", label: "13-31は入力", text: "DAY_TEXT" } });
  items.push({ type: "action", action: { type: "message", label: "戻る", text: "BACK_MONTH" } });
  return { items };
}

// ---- 無料テンプレ ----
function freeParts({ gender, birth }) {
  return [
    `ユーザーさん、ようこそ。\nまずは無料で「オーラの傾向」を簡易鑑定します。\n\n性別：${gender}\n生年月日：${birth}\n\n深呼吸して、肩の力を抜いてください。`,
    `あなたのオーラは「静かに芯が強い」タイプ。\n\n周囲に合わせ過ぎて疲れやすい一方で、決めたことは最後までやり切る粘りがあります。\n迷いが出たときほど、直感が働く方です。`,
    `最近は「気を使い過ぎ」から運気が散りやすい時期。\n\n本音を飲み込み続けると、判断が鈍ってしまいます。\n小さくても「自分の希望」を言語化すると、流れが整います。`,
    `ここまでが無料鑑定です。\n\nこの先は、お悩みに合わせてもう一段深く読み解けます。\n（恋愛・仕事・金運・生活など）\n\n必要なら、次に進みましょう。`,
  ];
}

// ---- 疎通確認 ----
app.get("/", (req, res) => res.status(200).send("VER1-GENDER-BIRTH-20260104"));

// ---- Webhook ----
app.post("/webhook", line.middleware({ channelSecret }), async (req, res) => {
  // 先に200（LINEタイムアウト回避）
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    console.log("events length:", events.length);

    for (const event of events) {
      const replyToken = event.replyToken;
      if (!replyToken) continue;

      // ✅ 友だち追加（follow）で自動スタート
      if (event.type === "follow") {
        const userId = getUserId(event);
        if (userId) resetUser(userId);

        await reply(replyToken, [
          {
            type: "text",
            text:
              "AI占いくんです。友だち追加ありがとうございます。\n" +
              "まずは無料で簡易鑑定を行います。\n\n" +
              "性別を教えてください。",
            quickReply: quickReplyGender(),
          },
        ]);
        continue;
      }

      // メッセージ以外は無視
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const userId = getUserId(event);
      const text = (event.message.text || "").trim();

      // userIdが取れない場合の最低限
      if (!userId) {
        await reply(replyToken, [{ type: "text", text: "受信しました。" }]);
        continue;
      }

      // 初回 or stateなしなら初期化
      if (!userStateMap.has(userId)) resetUser(userId);
      const st = userStateMap.get(userId);

      // 共通コマンド
      if (text === "最初から") {
        resetUser(userId);
        await reply(replyToken, [
          {
            type: "text",
            text: "最初から始めます。\n性別を教えてください。",
            quickReply: quickReplyGender(),
          },
        ]);
        continue;
      }

      // ---- 性別 ----
      if (st.step === "WAIT_GENDER") {
        if (!["男性", "女性", "その他"].includes(text)) {
          await reply(replyToken, [
            {
              type: "text",
              text: "まずは無料の簡易鑑定から始めます。\n性別を選んでください。",
              quickReply: quickReplyGender(),
            },
          ]);
          continue;
        }

        st.gender = text;
        st.step = "WAIT_BIRTH";
        st.birth = {};
        userStateMap.set(userId, st);

        await reply(replyToken, [
          {
            type: "text",
            text:
              "次に、生年月日を選びます。\n" +
              "まず年代を選んでください。\n\n" +
              "（難しければ「その他」で手入力に切り替えできます）",
            quickReply: quickReplyYearRange(),
          },
        ]);
        continue;
      }

      // ---- 生年月日（年代→年→月→日） ----
      if (st.step === "WAIT_BIRTH") {
        // 手入力へ切替
        if (text === "BIRTH_TEXT") {
          st.step = "WAIT_BIRTH_TEXT";
          userStateMap.set(userId, st);
          await reply(replyToken, [{ type: "text", text: "生年月日を入力してください。\n例）1990-01-31" }]);
          continue;
        }

        // 年代
        if (text.startsWith("YRANGE:")) {
          const startYear = Number(text.split(":")[1]);
          st.birth.yearRange = startYear;
          userStateMap.set(userId, st);

          await reply(replyToken, [
            {
              type: "text",
              text: `年を選んでください（${startYear}〜${startYear + 9}）`,
              quickReply: quickReplyYears(startYear),
            },
          ]);
          continue;
        }

        if (text === "BACK_YRANGE") {
          await reply(replyToken, [{ type: "text", text: "年代を選んでください。", quickReply: quickReplyYearRange() }]);
          continue;
        }

        // 年
        if (text.startsWith("Y:")) {
          const y = Number(text.split(":")[1]);
          st.birth.year = y;
          userStateMap.set(userId, st);

          await reply(replyToken, [{ type: "text", text: "月を選んでください。", quickReply: quickReplyMonths() }]);
          continue;
        }

        if (text === "BACK_YEAR") {
          const startYear = st.birth.yearRange || 1990;
          await reply(replyToken, [{ type: "text", text: "年を選んでください。", quickReply: quickReplyYears(startYear) }]);
          continue;
        }

        // 月
        if (text.startsWith("M:")) {
          const mm = text.split(":")[1];
          st.birth.month = mm;
          userStateMap.set(userId, st);

          const maxDay = daysInMonth(st.birth.year, mm);
          await reply(replyToken, [
            { type: "text", text: "日を選んでください（1〜12はボタン、13以降は入力でOK）", quickReply: quickReplyDays(maxDay) },
          ]);
          continue;
        }

        if (text === "BACK_MONTH") {
          await reply(replyToken, [{ type: "text", text: "月を選んでください。", quickReply: quickReplyMonths() }]);
          continue;
        }

        // 日（1〜12）
        if (text.startsWith("D:")) {
          const dd = text.split(":")[1];
          const y = st.birth.year;
          const mm = st.birth.month;

          const birth = `${y}-${mm}-${dd}`;
          st.birth = birth; // 文字列で確定
          st.step = "FREE_0";
          userStateMap.set(userId, st);

          const parts = freeParts({ gender: st.gender, birth });
          await reply(replyToken, [{ type: "text", text: parts[0], quickReply: quickReplyNext() }]);
          continue;
        }

        // 日（13以降は手入力）
        if (text === "DAY_TEXT") {
          st.step = "WAIT_DAY_TEXT";
          userStateMap.set(userId, st);
          await reply(replyToken, [{ type: "text", text: "日付（01〜31）だけ入力してください。\n例）07" }]);
          continue;
        }

        await reply(replyToken, [
          { type: "text", text: "年代→年→月→日 の順に選んでください。", quickReply: quickReplyYearRange() },
        ]);
        continue;
      }

      // ---- 日だけ手入力（13以降） ----
      if (st.step === "WAIT_DAY_TEXT") {
        const dd = text;

        if (!/^\d{2}$/.test(dd)) {
          await reply(replyToken, [{ type: "text", text: "2桁で入力してください。\n例）07" }]);
          continue;
        }

        const y = st.birth.year;
        const mm = st.birth.month;
        const maxDay = daysInMonth(y, mm);
        const dayNum = Number(dd);

        if (dayNum < 1 || dayNum > maxDay) {
          await reply(replyToken, [{ type: "text", text: `その月は01〜${String(maxDay).padStart(2, "0")}です。` }]);
          continue;
        }

        const birth = `${y}-${mm}-${dd}`;
        st.birth = birth;
        st.step = "FREE_0";
        userStateMap.set(userId, st);

        const parts = freeParts({ gender: st.gender, birth });
        await reply(replyToken, [{ type: "text", text: parts[0], quickReply: quickReplyNext() }]);
        continue;
      }

      // ---- 生年月日を完全手入力 ----
      if (st.step === "WAIT_BIRTH_TEXT") {
        if (!isValidBirth(text)) {
          await reply(replyToken, [{ type: "text", text: "形式が違うようです。\n例）1990-01-31" }]);
          continue;
        }

        const birth = text;
        st.birth = birth;
        st.step = "FREE_0";
        userStateMap.set(userId, st);

        const parts = freeParts({ gender: st.gender, birth });
        await reply(replyToken, [{ type: "text", text: parts[0], quickReply: quickReplyNext() }]);
        continue;
      }

      // ---- 無料テンプレ（次へ） ----
      if (typeof st.step === "string" && st.step.startsWith("FREE_")) {
        if (text !== "次へ") {
          await reply(replyToken, [{ type: "text", text: "「次へ」で進めます。", quickReply: quickReplyNext() }]);
          continue;
        }

        const idx = Number(st.step.split("_")[1] || "0");
        const parts = freeParts({ gender: st.gender, birth: st.birth });
        const nextIdx = idx + 1;

        if (nextIdx >= parts.length) {
          st.step = "DONE";
          userStateMap.set(userId, st);

          await reply(replyToken, [
            {
              type: "text",
              text:
                "無料鑑定は以上です。\n\n" +
                "このあと有料で、悩みに合わせて深掘り鑑定も可能です。\n" +
                "（準備中：恋愛/仕事/金運/生活）\n\n" +
                "続ける場合は「最初から」と送ってください。",
              quickReply: quickReplyNext(),
            },
          ]);
          continue;
        }

        st.step = `FREE_${nextIdx}`;
        userStateMap.set(userId, st);

        await reply(replyToken, [{ type: "text", text: parts[nextIdx], quickReply: quickReplyNext() }]);
        continue;
      }

      // ---- 終了後 ----
      if (st.step === "DONE") {
        await reply(replyToken, [{ type: "text", text: "続ける場合は「最初から」と送ってください。", quickReply: quickReplyNext() }]);
        continue;
      }

      // ---- 不明状態ならリセット ----
      resetUser(userId);
      await reply(replyToken, [
        { type: "text", text: "状態が不明になったため最初から始めます。\n性別を教えてください。", quickReply: quickReplyGender() },
      ]);
    }
  } catch (err) {
    console.error("webhook handler error:", err);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
