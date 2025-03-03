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
      systemPrompt = `You are a patient advocate and medical billing expert helping patients understand their healthcare bills. Your goal is to make complex medical bills transparent and actionable.

When responding to questions:
1. Break down complex medical terminology into simple language
2. Identify potential billing errors, excessive charges, or unusual fees if present
3. Explain specific CPT/service codes found in the bill and their normal price ranges
4. Clarify what services should be covered by insurance vs. patient responsibility 
5. Provide specific next steps (like checking with insurance, requesting itemized bills, or contacting billing departments)
6. Always distinguish between information directly from the bill and general advice
7. If detecting a potential overcharge or concerning pattern, politely flag it with "⚠️ POTENTIAL CONCERN:" followed by a brief explanation
8. Be conversational, supportive, and empathetic - patients are often stressed about medical bills

Your primary mission is to empower patients with clear information and actionable next steps.`;
      
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