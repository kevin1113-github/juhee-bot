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
  speed: number = 30,
  retryCount: number = 0
) {
  const MAX_RETRIES = 2;
  
  try {
    if (!SPEECH_KEY || !SPEECH_REGION) {
      logger.error("Speech API credentials not configured");
      if (typeof callback === 'function') {
        try {
          callback(null);
        } catch (callbackError) {
          logger.error("Error calling callback for missing credentials:", callbackError);
        }
      }
      return;
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      SPEECH_KEY,
      SPEECH_REGION
    );

    let language: string;
    let voice: string;
    // const detectedLanguage = await recognizeLanguage(textData);
    const detectedLanguage = (voiceName == 'HyunsuMultilingualNeural') ? 'ko' : quickLanguageDetect(textData);

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
            
            // websocket 에러나 내부 서버 에러의 경우 재시도
            const errorMessage = result.errorDetails?.toString() || '';
            const isRetriableError = errorMessage.includes('websocket error') || 
                                    errorMessage.includes('Internal server error') ||
                                    errorMessage.includes('1011');
            
            if (isRetriableError && retryCount < MAX_RETRIES) {
              logger.warn(`TTS synthesis error with retriable error, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
              setTimeout(() => {
                msTTS(textData, callback, voiceName, speed, retryCount + 1);
              }, 1000 * (retryCount + 1)); // 1초, 2초 간격으로 재시도
            } else {
              // 재시도 불가능하거나 재시도 횟수 초과 시 콜백 호출
              if (typeof callback === 'function') {
                try {
                  callback(null); // null을 전달하여 오디오가 없음을 알림
                } catch (callbackError) {
                  logger.error("Error calling callback after TTS error:", callbackError);
                }
              }
            }
            return;
          }

          const { audioData } = result;
          if (!audioData) {
            logger.warn("TTS audioData is empty");
            // 오디오 데이터가 없어도 콜백을 호출
            if (typeof callback === 'function') {
              try {
                callback(null);
              } catch (callbackError) {
                logger.error("Error calling callback for empty audioData:", callbackError);
              }
            }
            return;
          }

          // convert arrayBuffer to stream
          const bufferStream = new PassThrough();
          bufferStream.end(Buffer.from(audioData));
          if (typeof callback === 'function') {
            try {
              callback(bufferStream);
              logger.debug("✅ TTS synthesis completed successfully");
            } catch (callbackError) {
              logger.error("Error calling callback with audio stream:", callbackError);
            }
          }
        } catch (callbackError) {
          logger.error("Error in TTS callback:", callbackError);
          // 콜백 에러가 발생해도 안전하게 처리
          try {
            if (typeof callback === 'function') {
              callback(null);
            }
          } catch (safeCallbackError) {
            logger.error("Error in safe callback call:", safeCallbackError);
          }
        }
      },
      (error) => {
        logger.error("TTS synthesis failed:", error);
        speechSynthesizer.close();
        
        // websocket 에러나 내부 서버 에러의 경우 재시도
        const errorMessage = error?.toString() || '';
        const isRetriableError = errorMessage.includes('websocket error') || 
                                errorMessage.includes('Internal server error') ||
                                errorMessage.includes('1011');
        
        if (isRetriableError && retryCount < MAX_RETRIES) {
          logger.warn(`TTS synthesis failed with retriable error, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
          setTimeout(() => {
            msTTS(textData, callback, voiceName, speed, retryCount + 1);
          }, 1000 * (retryCount + 1)); // 1초, 2초 간격으로 재시도
        } else {
          // 재시도 불가능하거나 재시도 횟수 초과 시 콜백 호출
          if (typeof callback === 'function') {
            try {
              callback(null);
            } catch (callbackError) {
              logger.error("Error calling callback after synthesis failure:", callbackError);
            }
          }
        }
      }
    );
  } catch (error) {
    logger.error("Failed to initialize TTS:", error);
    
    // 재시도 로직
    if (retryCount < MAX_RETRIES) {
      logger.warn(`TTS failed, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
      setTimeout(() => {
        msTTS(textData, callback, voiceName, speed, retryCount + 1);
      }, 1000 * (retryCount + 1)); // 1초, 2초 간격으로 재시도
    } else {
      logger.error("TTS failed after all retries, calling callback with null");
      if (typeof callback === 'function') {
        try {
          callback(null);
        } catch (callbackError) {
          logger.error("Error calling callback after final TTS failure:", callbackError);
        }
      }
    }
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
