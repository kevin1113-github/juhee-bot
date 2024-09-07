import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { __dirname } from './const.js';
import { PassThrough } from 'stream';
import { TextAnalyticsClient, AzureKeyCredential, DetectLanguageResultArray, DetectLanguageResult } from "@azure/ai-text-analytics";

import dotenv from "dotenv";
dotenv.config();
const SPEECH_KEY: string = process.env.SPEECH_KEY ?? '';
const SPEECH_REGION: string = process.env.SPEECH_REGION ?? '';
const DEFAULT_VOICE: string = 'SeoHyeonNeural';
const LANGUAGE_KEY = process.env.LANGUAGE_KEY ?? '';
const LANGUAGE_ENDPOINT = process.env.LANGUAGE_ENDPOINT ?? '';
const client = new TextAnalyticsClient(LANGUAGE_ENDPOINT, new AzureKeyCredential(LANGUAGE_KEY));

async function msTTS(textData: string, callback: Function, voiceName: string = DEFAULT_VOICE, speed: number = 30) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  
  const voice = (await recognizeLanguage(textData)) == 'ja' ? 'ja-JP-AoiNeural' : 'ko-KR-' + (voiceName ?? DEFAULT_VOICE);

  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Ogg48Khz16BitMonoOpus;
  speechConfig.speechSynthesisVoiceName = voice;

  const speechSynthesizer = new sdk.SpeechSynthesizer(speechConfig);
  //  xml:lang="ko-KR"
  const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" version="1.0"><voice name="${voice}"><prosody rate="+${speed??30}.00%">${textData}</prosody></voice></speak>`

  speechSynthesizer.speakSsmlAsync(
    ssml, result => {
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
  const result: DetectLanguageResult = (await client.detectLanguage([text]))[0];
  if (!result.error) {
    return result.primaryLanguage.iso6391Name;
  }
  else {
    return 'ko-KR';
  }
}

export default msTTS;