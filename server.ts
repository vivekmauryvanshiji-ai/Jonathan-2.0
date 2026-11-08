import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '10mb' }));

  // Initialize Gemini AI Client on the server side
  const apiKey = process.env.GEMINI_API_KEY;
  let ai: GoogleGenAI | null = null;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  // System instruction for Jonathan 2.0 AI Assistant
  const JONATHAN_SYSTEM_PROMPT = `
You are "Jonathan AI" (जोनाथन एआई) — an elite, encouraging, and authoritative Indian academic mentor and topper assistant for the "Jonathan 2.0" academic portal.
You specialize in Classes 9th, 10th (Board), 11th, and 12th (Board & Entrance foundations like JEE/NEET).
Your subjects of expertise:
- Physics (भौतिक विज्ञान)
- Chemistry (रसायन विज्ञान)
- Mathematics (गणित)
- Biology (जीव विज्ञान)
- Hindi (हिंदी व्याकरण, काव्य, गद्य)
- English (Grammar, Writing Skills, Literature)

CRITICAL LANGUAGE ENFORCEMENT RULES (भाषा नियम):
The user can explicitly select one of three language modes: 'hindi', 'english', or 'hinglish'.
1. IF language is 'english' OR the user asks in English:
   - Your response MUST BE 100% IN PROPER, ELEGANT ENGLISH.
   - Do NOT use Devanagari Hindi words.
   - Keep terminology completely in standard English (e.g., "Electrostatics", "Coulomb's Law", "Molarity", "Roots of Quadratic Equation", "Given Data", "Formula Used", "Step-by-step Solution", "Topper Tip").
2. IF language is 'hindi' OR the user asks in Hindi (Devanagari):
   - Your response MUST BE COMPLETELY IN NATURAL, SCHOLARLY HINDI (Devanagari script: 'नमस्ते! मैं Jonathan AI हूँ...').
   - You may include standard English scientific terms in brackets for clarity (e.g., "विद्युत क्षेत्र (Electric Field)").
   - All explanations, headings, steps, and tips must be in Hindi.
3. IF language is 'hinglish' OR the user asks in Hinglish (Romanized Hindi like "Bhai ye samjha do"):
   - Answer in friendly, natural Hinglish (Roman script Hindi mixed with English terms, e.g., "Namaste! Main Jonathan AI hoon. Chaliye is concept ko step-by-step clear karte hain...").
4. ALWAYS MATCH THE USER'S PROMPT LANGUAGE: If the user directly types in English, answer fully in English. If they type in Hindi, answer in Hindi.

Teaching & Problem-Solving Method:
1. For Numerical / Math questions: ALWAYS follow a strict, crisp step-by-step format:
   - Given Data / दिया गया मान (with SI units)
   - Formula Used / प्रयुक्त सूत्र
   - Step-by-Step Calculation / मान प्रतिस्थापन एवं गणना
   - Final Answer & Unit / अंतिम उत्तर व मात्रक
   - Topper Tip / परीक्षा सावधानी व शॉर्टकट
2. For Conceptual / Theory questions: Clear bullet points, definitions, real-life examples, and key highlights.
3. Keep formatting clean with markdown headings (###), bold keywords, and clean equations.
`;

  // API endpoint for Chat
  app.post('/api/chat', async (req: Request, res: Response): Promise<void> => {
    try {
      const { message, history, context } = req.body;

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      const requestedLang = context?.language || (req.body as any)?.language || 'hindi'; // 'hindi' | 'english' | 'hinglish'

      if (!ai) {
        // Fallback response if API key is temporarily unavailable in environment
        let fallbackMsg = '';
        if (requestedLang === 'english') {
          fallbackMsg = `Hello! I am Jonathan AI, your academic mentor. I received your question: "${message}".
Class: ${context?.classId || '12th'} | Subject: ${context?.subjectId || 'General'}.
Please ensure GEMINI_API_KEY is configured in Settings > Secrets. I am ready to resolve all your Physics, Chemistry, Maths, Biology, Hindi, and English doubts in English!`;
        } else if (requestedLang === 'hinglish') {
          fallbackMsg = `Namaste! Main Jonathan AI hoon. Aapka sawaal: "${message}" receive ho gaya hai.
Class: ${context?.classId || '12th'} | Subject: ${context?.subjectId || 'General'}.
Please make sure GEMINI_API_KEY Settings > Secrets me configured hai. Main aapke sabhi doubts solve karne ke liye ready hoon!`;
        } else {
          fallbackMsg = `नमस्ते! मैं Jonathan AI हूँ। वर्तमान में आपका प्रश्न: "${message}" प्राप्त हुआ है। 
कक्षा: ${context?.classId || '12th'} | विषय: ${context?.subjectId || 'सामान्य'}।
कृपया सुनिश्चित करें कि Settings > Secrets में GEMINI_API_KEY कॉन्फ़िगर है। मैं आपके सभी शैक्षणिक प्रश्नों का समाधान करने के लिए सदैव तत्पर हूँ!`;
        }

        res.json({ reply: fallbackMsg });
        return;
      }

      // Format conversation history for Gemini
      const formattedContents = [];

      // Contextual prompt with explicit language enforcement
      let contextualInstruction = JONATHAN_SYSTEM_PROMPT;
      contextualInstruction += `\nCURRENT STUDENT CONTEXT:
- Academic Class: ${context?.classId || '12th'}
- Current Subject: ${context?.subjectId || 'Physics'}
- Explicit Selected Language Preference: ${requestedLang.toUpperCase()}
MANDATORY: Follow the ${requestedLang.toUpperCase()} language rule strictly! If the user writes in English, reply 100% in English. If they write in Hindi, reply in Hindi.`;

      // If history exists, map it
      if (Array.isArray(history) && history.length > 0) {
        for (const item of history.slice(-8)) { // keep last 8 messages for context
          formattedContents.push({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: item.text }],
          });
        }
      }

      // Add current message
      formattedContents.push({
        role: 'user',
        parts: [{ text: message }],
      });

      // Call Gemini 3.8 Flash model
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: formattedContents,
        config: {
          systemInstruction: contextualInstruction,
        },
      });

      const replyText = response.text || (requestedLang === 'english' ? 'Sorry, could not generate a response. Please try again.' : 'क्षमा करें, उत्तर तैयार करने में तकनीकी समस्या हुई। कृपया पुनः प्रयास करें।');
      res.json({ reply: replyText });
    } catch (error: any) {
      console.error('Error generating AI response:', error);
      res.status(500).json({
        error: 'Failed to generate response',
        details: error?.message || 'Unknown error',
      });
    }
  });

  // Mount Vite middlewares in development or serve static in production
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
