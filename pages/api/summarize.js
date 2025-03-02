import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a medical bill expert. Provide a clear, concise summary of the key information in medical bills."
        },
        {
          role: "user",
          content: `Please provide a brief, clear summary of this medical bill text. Focus on key information like total amount, main services, and important dates. Keep it concise and easy to understand.

Text to summarize:
${text}`
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    const summary = completion.choices[0].message.content;
    return res.status(200).json({ summary });

  } catch (error) {
    console.error('Summary generation error:', error);
    return res.status(500).json({
      error: 'Failed to generate summary',
      details: error.message
    });
  }
} 