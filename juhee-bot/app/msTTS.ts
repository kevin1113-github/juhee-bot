import sdk from 'microsoft-cognitiveservices-speech-sdk';
import { __dirname } from './const.js';
import { PassThrough } from 'stream';

import dotenv from "dotenv";
dotenv.config();
const SPEECH_KEY: string = process.env.SPEECH_KEY ?? '';
const SPEECH_REGION: string = process.env.SPEECH_REGION ?? '';
const DEFAULT_VOICE: string = 'SeoHyeonNeural';

function msTTS(textData: string, callback: Function, voiceName: string = DEFAULT_VOICE, speed: number = 30) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Ogg48Khz16BitMonoOpus;
  speechConfig.speechSynthesisVoiceName = 'ko-KR-' + (voiceName ?? DEFAULT_VOICE);

  const speechSynthesizer = new sdk.SpeechSynthesizer(speechConfig);

  const ssml = `<speak xmlns="http://www.w3.org/2001/10/synthesis" version="1.0" xml:lang="ko-KR"><voice name="ko-KR-${voiceName ?? DEFAULT_VOICE}"><prosody rate="+${speed??30}.00%">${textData}</prosody></voice></speak>`

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

export default msTTS;