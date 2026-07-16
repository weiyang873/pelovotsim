const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_IMAGE_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-2.0-flash-exp"
];
const IMAGEN_MODEL = "imagen-3.0-generate-002";

function requireApiKey() {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  return apiKey;
}

function buildDataUrl(base64, mimeType = "image/png") {
  return `data:${mimeType};base64,${base64}`;
}

function extractAgeScene(gridLabel) {
  const label = String(gridLabel || "").trim().toLowerCase();

  if (label.includes("老人") || label.includes("elder")) {
    return {
      scene: "A cozy living room with warm lighting and a comfortable armchair nearby",
      emotion: "Gentle, caring, watchful",
      color: "Soft sage green or warm beige",
      userDesc: "an elderly person (60+)"
    };
  }
  if (label.includes("儿童") || label.includes("child")) {
    return {
      scene: "A bright playroom with toys, books, and cheerful daylight",
      emotion: "Playful, curious, excited",
      color: "Bright yellow or sky blue",
      userDesc: "a young child (3-8 years old)"
    };
  }
  return {
    scene: "A modern apartment living room with calm evening lighting",
    emotion: "Warm, welcoming, calm",
    color: "Soft coral or muted teal",
    userDesc: "a young adult"
  };
}

function extractArchitectureStyle(arch) {
  const raw = String(arch || "").trim().toLowerCase();
  if (raw === "experience") {
    return "The accessory and scene details should feel emotionally rich, comforting, and premium.";
  }
  if (raw === "hybrid") {
    return "The accessory and scene details should balance practicality with warmth.";
  }
  if (raw === "function") {
    return "The accessory and scene details should feel clear, practical, and purposeful.";
  }
  return "";
}

function buildPrompt(who, pain, how, gridLabel, arch) {
  const ageScene = extractAgeScene(gridLabel);
  const architectureStyle = extractArchitectureStyle(arch);

  return [
    "Generate a single presentation-ready illustration of an AI pet robot.",
    "",
    "Keep the AI pet robot's core appearance fixed. Do not redesign the robot itself.",
    "AI pet robot fixed appearance:",
    "- Round, soft, plump body shape like a bean-sized companion robot",
    "- Two very large expressive eyes on top of the head",
    "- Small flipper-like arms on the sides",
    "- Hidden wheel base so it can glide smoothly",
    "- Warm, huggable, premium texture",
    "",
    "Customize only the surrounding context and small visual accents:",
    `- Scene/background: ${ageScene.scene}`,
    `- Eye expression: ${ageScene.emotion}`,
    `- Body accent color: ${ageScene.color}`,
    `- One small accessory or nearby prop representing this solution: ${how || "the team's product idea"}`,
    `- Show ${ageScene.userDesc} nearby or interacting with the AI pet robot`,
    architectureStyle ? `- ${architectureStyle}` : "",
    "",
    `Target user: ${who || "A clearly defined customer segment"}`,
    `Need or pain point: ${pain || "An important unmet emotional or practical need"}`,
    "",
    "Style requirements:",
    "- Clean vector illustration",
    "- Warm lighting",
    "- White or very light presentation background",
    "- No text",
    "- No watermark",
    "- One robot only",
    "- Square composition suitable for classroom projection",
    "- 1:1 aspect ratio, 1024x1024"
  ].filter(Boolean).join("\n");
}

async function parseGeminiImageResponse(response) {
  const data = await response.json();
  const parts = Array.isArray(data?.candidates)
    ? data.candidates.flatMap((candidate) => candidate?.content?.parts || [])
    : [];
  const imagePart = parts.find((part) => part?.inlineData?.mimeType?.startsWith("image/"));

  if (!imagePart?.inlineData?.data) {
    const preview = parts
      .map((part) => String(part?.text || "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ");
    throw new Error(`Gemini did not return an image${preview ? `: ${preview}` : ""}`);
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png"
  };
}

async function generateWithGeminiModel(model, prompt, apiKey) {
  const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    const error = new Error(`Gemini model ${model} failed with ${response.status}: ${errText}`);
    error.status = response.status;
    throw error;
  }

  return parseGeminiImageResponse(response);
}

function parseImagenPrediction(data) {
  const candidates = [];

  if (Array.isArray(data?.predictions)) {
    candidates.push(...data.predictions);
  }
  if (Array.isArray(data?.generatedImages)) {
    candidates.push(...data.generatedImages);
  }

  for (const item of candidates) {
    const base64 = item?.bytesBase64Encoded || item?.imageBytes || item?.data || item?.encodedImage;
    if (base64) {
      return {
        base64,
        mimeType: item?.mimeType || "image/png"
      };
    }
  }

  throw new Error("Imagen did not return an image");
}

async function generateWithImagen(prompt, apiKey) {
  const response = await fetch(`${GEMINI_API_BASE}/${IMAGEN_MODEL}:predict?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "1:1"
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Imagen fallback failed with ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return parseImagenPrediction(data);
}

async function generateProductImage(vpData) {
  const { who, pain, how, gridLabel, arch } = vpData || {};
  const apiKey = requireApiKey();
  const prompt = buildPrompt(who, pain, how, gridLabel, arch);
  const errors = [];

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const image = await generateWithGeminiModel(model, prompt, apiKey);
      return { ...image, modelUsed: model };
    } catch (error) {
      errors.push(error.message || String(error));
      const status = Number(error?.status || 0);
      if (status && ![400, 404, 405].includes(status)) {
        throw error;
      }
    }
  }

  try {
    const image = await generateWithImagen(prompt, apiKey);
    return { ...image, modelUsed: IMAGEN_MODEL };
  } catch (error) {
    errors.push(error.message || String(error));
    throw new Error(`Product image generation failed. ${errors.join(" | ")}`);
  }
}

module.exports = {
  buildDataUrl,
  extractAgeScene,
  buildPrompt,
  generateProductImage
};
