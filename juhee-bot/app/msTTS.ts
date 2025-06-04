import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { __dirname } from './const.js';
import { PassThrough } from 'stream';
import { TextAnalyticsClient, AzureKeyCredential, DetectLanguageResultArray, DetectLanguageResult } from "@azure/ai-text-analytics";

import dotenv from "dotenv";
import { recognizeOption } from './api.js';
dotenv.config();
const SPEECH_KEY: string = process.env.SPEECH_KEY ?? '';
const SPEECH_REGION: string = process.env.SPEECH_REGION ?? '';
const DEFAULT_VOICE: string = 'SeoHyeonNeural';
const LANGUAGE_KEY = process.env.LANGUAGE_KEY ?? '';
const LANGUAGE_ENDPOINT = process.env.LANGUAGE_ENDPOINT ?? '';
const client = new TextAnalyticsClient(LANGUAGE_ENDPOINT, new AzureKeyCredential(LANGUAGE_KEY));

async function msTTS(textData: string, callback: Function, voiceName: string = DEFAULT_VOICE, speed: number = 30) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  
  let language: string;
  let voice: string;
  switch (await recognizeLanguage(textData)) {
    case 'ko':
      language = 'ko-KR';
      voice = language + '-' + (voiceName ?? DEFAULT_VOICE);
      break;
    case 'ja':
      language = 'ja-JP';
      voice = language + '-AoiNeural';
      break;
    case 'en':
      language = 'en-US';
      voice = language + '-AnaNeural';
      break;
    default:
      language = 'ko-KR';
      voice = language + '-' + (voiceName ?? DEFAULT_VOICE);
      break;
  }

  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Ogg48Khz16BitMonoOpus;
  speechConfig.speechSynthesisLanguage = language;
  speechConfig.speechSynthesisVoiceName = voice;

  const speechSynthesizer = new sdk.SpeechSynthesizer(speechConfig);
  const ssml =
  `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${language}">
    <voice name="${voice}">
      <prosody rate="+${speed??30}%">${textData}</prosody>
    </voice>
  </speak>`;

  // console.log(ssml);

  speechSynthesizer.speakSsmlAsync(
    ssml, result => {
      // console.log(result.resultId)
      // if (result.errorDetails) {
      //   console.log(result.errorDetails);
      // } else {
      //   console.log(JSON.stringify(result));
      // }
      speechSynthesizer.close();

      const { audioData } = result;
      if (!audioData) {
        console.log('audioData is empty');
        return;
      }

      // convert arrayBuffer to stream
      const bufferStream = new PassThrough();
      bufferStream.end(Buffer.from(audioData));
      callback(bufferStream);
    },
    error => {
      console.log(error);
      speechSynthesizer.close();
  });
}

async function recognizeLanguage(text: string): Promise<string> {
  if (recognizeOption) {
    const result: DetectLanguageResult = (await client.detectLanguage([text]))[0];
    if (!result.error) {
      return result.primaryLanguage.iso6391Name;
    }
    else {
      return 'ko-KR';
    }
  }
  else {
    return 'ko-KR';
  }
}

export default msTTS;