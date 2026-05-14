// /api/send-notification.js
// 八木中ネット 統合メール通知API（Resend）
// グループウェア・イベントナビ・見守りナビ共通

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

  try {
    const { type, title, body, emails, senderName } = req.body;

    // バリデーション
    if (!type || !title || !body) {
      return res.status(400).json({ error: "type, title, body are required" });
    }
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "emails array is required and must not be empty" });
    }

    // メール件名のプレフィックス（アプリ種別で分ける）
    const subjectPrefix = {
      // グループウェア
      "notice": "【八木中ネット】",
      // イベントナビ
      "event-approved-organizer": "【イベントナビ】",
      "event-revision": "【イベントナビ】",
      "event-rejected": "【イベントナビ】",
      "event-new": "【イベントナビ】",
      "event-emergency": "【イベントナビ】",
      // 見守りナビ（将来用）
      "mimamori": "【見守りナビ】",
    }[type] || "【八木中ネット】";

    const subject = `${subjectPrefix} ${title}`;

    // 送信元（Resend無料枠のデフォルトドメイン）
    // 独自ドメイン設定後は "noreply@yourdomain.com" に変更
    const from = `${senderName || "八木中ネット"} <noreply@yagiyama-net.com>`;

    // 個別送信（1メール1受信者）
    // - 受信者同士でメールアドレスが見えない（プライバシー保護）
    // - BCC一括送信よりGmail等での到達率が高い
    // - 1メールずつTOに本人のアドレスを設定するため迷惑メール判定されにくい
    const htmlBody = buildHtml(type, title, body, senderName);
    const sendOne = async (email) => {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [email],
            subject,
            html: htmlBody,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          console.error(`Resend error to ${email}:`, data);
          return { email, success: false, error: data };
        }
        return { email, success: true, id: data.id };
      } catch (e) {
        console.error(`Resend exception for ${email}:`, e);
        return { email, success: false, error: String(e) };
      }
    };

    // 並列実行（Resend のレート制限: 10 req/sec を考慮し10件ずつ）
    const CONCURRENT = 10;
    const results = [];
    for (let i = 0; i < emails.length; i += CONCURRENT) {
      const chunk = emails.slice(i, i + CONCURRENT);
      const chunkResults = await Promise.all(chunk.map(sendOne));
      results.push(...chunkResults);
      // レート制限回避用の小休止（次バッチがある場合のみ）
      if (i + CONCURRENT < emails.length) {
        await new Promise(r => setTimeout(r, 1100));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const allSuccess = successCount === emails.length;
    return res.status(allSuccess ? 200 : 207).json({
      message: allSuccess ? "All emails sent" : `${successCount}/${emails.length} sent`,
      successCount,
      totalEmails: emails.length,
      failures: results.filter(r => !r.success),
    });

  } catch (error) {
    console.error("send-notification error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// メール本文HTML生成
function buildHtml(type, title, body, senderName) {
  const appLabel = {
    "notice": "グループウェア",
    "event-approved-organizer": "イベントナビ",
    "event-revision": "イベントナビ",
    "event-rejected": "イベントナビ",
    "event-new": "イベントナビ",
    "event-emergency": "イベントナビ",
    "mimamori": "見守りナビ",
  }[type] || "八木中ネット";

  const accentColor = {
    "notice": "#2563eb",
    "event-approved-organizer": "#16a34a",
    "event-revision": "#d97706",
    "event-rejected": "#dc2626",
    "event-new": "#2563eb",
    "event-emergency": "#dc2626",
    "mimamori": "#16a34a",
  }[type] || "#2563eb";

  // 改行をbrタグに変換
  const bodyHtml = body.replace(/\n/g, "<br>");

  return `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,sans-serif;">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:${accentColor};padding:20px 24px;">
      <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-bottom:4px;">${appLabel}</div>
      <div style="color:#fff;font-size:18px;font-weight:700;">${title}</div>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.8;color:#374151;">
      ${bodyHtml}
    </div>
    ${senderName ? `<div style="padding:0 24px 16px;font-size:12px;color:#9ca3af;">投稿者: ${senderName}</div>` : ""}
    <div style="padding:16px 24px;text-align:center;">
      <a href="https://yagiyama-net.vercel.app" style="display:inline-block;padding:10px 28px;background:${accentColor};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">八木中ネットを開く</a>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #f3f4f6;font-size:11px;color:#9ca3af;text-align:center;">
      このメールは八木中ネットから自動送信されています。<br>
      八木山中学校PTA
    </div>
  </div>
</body>
</html>`;
}
