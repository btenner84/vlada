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
      systemPrompt = `You are a helpful medical bill expert assistant with extensive knowledge of medical billing, CPT codes, and healthcare services. When asked about CPT codes:
1. Look for any CPT codes in the bill context
2. If specific CPT codes are not found, suggest the most common CPT codes for the mentioned services based on standard medical billing practices
3. Explain what each CPT code means and its typical usage
4. Include typical price ranges for these services when available
5. Note clearly when you're providing general information vs. specific information from the bill`;
      
      userPrompt = `Using the following medical bill information as context, please answer this question. If specific information is not in the bill, provide helpful general information about typical billing practices for these services.

Question: ${text}

Bill Context:
${context}

If the bill doesn't contain specific CPT codes, suggest the most common ones for any mentioned services and explain your suggestions. Always be clear about what information comes directly from the bill versus general medical billing knowledge.`;
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