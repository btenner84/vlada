import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, context, mode } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    let systemPrompt, userPrompt;

    if (mode === 'qa') {
      systemPrompt = "You are a helpful medical bill expert assistant. Provide clear, concise answers to questions about medical bills. Use the provided bill context to give accurate, specific answers.";
      userPrompt = `Using the following medical bill information as context, please answer this question:

Question: ${text}

Bill Context:
${context}

Please provide a clear, direct answer based on the information in the bill. If the information needed is not available in the context, say so.`;
    } else {
      systemPrompt = "You are a medical bill expert. Provide a clear, concise summary of the key information in medical bills.";
      userPrompt = `Please provide a brief, clear summary of this medical bill information. Focus on key information like total amount, main services, and important dates. Keep it concise and easy to understand.

Bill Information:
${text}`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    const summary = completion.choices[0].message.content;
    return res.status(200).json({ summary });

  } catch (error) {
    console.error('Summary/QA generation error:', error);
    return res.status(500).json({
      error: 'Failed to generate response',
      details: error.message
    });
  }
} 