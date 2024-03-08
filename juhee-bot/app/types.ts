import { Model } from "sequelize";
import { AudioPlayer } from '@discordjs/voice';
import Action from "./action.js";

export type DATA = Model<any, any>;
export type GuildData = { guildId: string, audioPlayer: AudioPlayer | null, action: Action, timeOut: NodeJS.Timeout | null };