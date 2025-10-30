/**
 * @fileoverview 타입 정의
 * @description 프로젝트에서 사용하는 타입 선언
 * @author kevin1113dev
 */

import { Model } from "sequelize";
import { AudioPlayer } from '@discordjs/voice';
import Action from "./action.js";

/**
 * Sequelize 모델 타입
 */
export type DATA = Model<any, any>;

/**
 * 길드(서버) 데이터 타입
 * 
 * @remarks
 * 각 Discord 서버별로 오디오 플레이어, 액션 인스턴스, 타임아웃을 관리
 */
export type GuildData = { 
  /** Discord 서버(길드) ID */
  guildId: string;
  
  /** 오디오 플레이어 인스턴스 */
  audioPlayer: AudioPlayer | null;
  
  /**
   * 오디오 믹서 (현재 비활성화)
   * 동시재생 기능을 위한 믹서
   */
  // audioMixer: AudioMixer | null;
  
  /** 액션 관리 인스턴스 */
  action: Action;
  
  /** 30분 후 자동 퇴장을 위한 타임아웃 */
  timeOut: NodeJS.Timeout | null;
};