import { Model } from "sequelize";
import { AudioPlayer } from '@discordjs/voice';
import Action from "./action.js";
// import { AudioMixer } from "node-audio-mixer";

export type DATA = Model<any, any>;
export type GuildData = { 
  guildId: string, 
  audioPlayer: AudioPlayer | null, 
  // audioMixer: AudioMixer | null,
  action: Action, 
  timeOut: NodeJS.Timeout | null 
};