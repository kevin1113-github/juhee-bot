import sdk from "microsoft-cognitiveservices-speech-sdk";
import { __dirname } from "./const.js";
import { PassThrough } from "stream";
import {
  TextAnalyticsClient,
  AzureKeyCredential,
} from "@azure/ai-text-analytics";

import dotenv from "dotenv";
import { logger } from "./logger.js";
dotenv.config();
const SPEECH_KEY: string = process.env.SPEECH_KEY ?? "";
const SPEECH_REGION: string = process.env.SPEECH_REGION ?? "";
const DEFAULT_VOICE: string = "SeoHyeonNeural";
const LANGUAGE_KEY = process.env.LANGUAGE_KEY ?? "";
const LANGUAGE_ENDPOINT = process.env.LANGUAGE_ENDPOINT ?? "";
const client = new TextAnalyticsClient(
  LANGUAGE_ENDPOINT,
  new AzureKeyCredential(LANGUAGE_KEY)
);

async function msTTS(
  textData: string,
  callback: Function,
  voiceName: string = DEFAULT_VOICE,
  speed: number = 30
) {
  try {
    if (!SPEECH_KEY || !SPEECH_REGION) {
      logger.error("Speech API credentials not configured");
      return;
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      SPEECH_KEY,
      SPEECH_REGION
    );

    let language: string;
    let voice: string;
    // const detectedLanguage = await recognizeLanguage(textData);
    const detectedLanguage = quickLanguageDetect(textData);

    switch (detectedLanguage) {
      case "ko":
        language = "ko-KR";
        voice = language + "-" + (voiceName ?? DEFAULT_VOICE);
        break;
      case "ja":
        language = "ja-JP";
        voice = language + "-AoiNeural";
        break;
      case "en":
        language = "en-US";
        voice = language + "-AnaNeural";
        break;
      default:
        language = "ko-KR";
        voice = language + "-" + (voiceName ?? DEFAULT_VOICE);
        break;
    }

    logger.debug(
      `🗣️  TTS: ${textData.substring(0, 50)}... (${language}, ${voice})`
    );

    // speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm;
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Ogg24Khz16BitMonoOpus;
    speechConfig.speechSynthesisLanguage = language;
    speechConfig.speechSynthesisVoiceName = voice;

    const speechSynthesizer = new sdk.SpeechSynthesizer(speechConfig);
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">
    <voice name="${voice}">
      <prosody rate="+${speed ?? 30}%">${textData}</prosody>
    </voice>
  </speak>`;

    // console.log(ssml);

    speechSynthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        try {
          speechSynthesizer.close();

          if (result.errorDetails) {
            logger.error("TTS synthesis error:", result.errorDetails);
            return;
          }

          const { audioData } = result;
          if (!audioData) {
            logger.warn("TTS audioData is empty");
            return;
          }

          // convert arrayBuffer to stream
          const bufferStream = new PassThrough();
          bufferStream.end(Buffer.from(audioData));
          callback(bufferStream);
          logger.debug("✅ TTS synthesis completed successfully");
        } catch (callbackError) {
          logger.error("Error in TTS callback:", callbackError);
        }
      },
      (error) => {
        logger.error("TTS synthesis failed:", error);
        speechSynthesizer.close();
      }
    );
  } catch (error) {
    logger.error("Failed to initialize TTS:", error);
  }
}

// async function recognizeLanguage(text: string): Promise<string> {
//   try {
//     if (recognizeOption && LANGUAGE_KEY && LANGUAGE_ENDPOINT) {
//       const result: DetectLanguageResult = (await client.detectLanguage([text]))[0];
//       if (!result.error) {
//         logger.debug(`🌍 Detected language: ${result.primaryLanguage.iso6391Name}`);
//         return result.primaryLanguage.iso6391Name;
//       } else {
//         logger.warn("Language detection failed, defaulting to Korean:", result.error);
//         return 'ko';
//       }
//     } else {
//       return 'ko';
//     }
//   } catch (error) {
//     logger.error("Error in language recognition:", error);
//     return 'ko';
//   }
// }

// 간단한 로컬 언어 감지로 API 호출 줄이기
function quickLanguageDetect(text: string): string {
  const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/;
  const japaneseRegex = /[ひらがなカタカナ]/;
  const englishRegex = /^[a-zA-Z\s\d\.,!?]+$/;

  if (koreanRegex.test(text)) return "ko";
  if (japaneseRegex.test(text)) return "ja";
  if (englishRegex.test(text)) return "en";
  return "ko"; // 기본값
}

export default msTTS;
