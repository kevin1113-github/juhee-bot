/**
 * @fileoverview Discord 슬래시 커맨드 정의
 * @description 봇이 사용하는 모든 슬래시 커맨드를 정의
 * @author kevin1113dev
 */

import { ChannelType, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from 'discord.js';

/**
 * 슬래시 커맨드 목록
 * 
 * @remarks
 * - /들어와: 음성 채널 참가
 * - /나가: 음성 채널 퇴장
 * - /채널설정: TTS 채널 설정
 * - /채널해제: TTS 채널 해제
 * - /목소리설정: TTS 목소리 변경
 * - /현재목소리: 현재 설정된 목소리 확인
 * - /속도설정: TTS 속도 조절
 * - /음소거: 봇 음소거
 * - /음소거해제: 봇 음소거 해제
 */
const Commands: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup"> | SlashCommandOptionsOnlyBuilder[] = [
  new SlashCommandBuilder()
    .setName('들어와')
    .setDescription('음성채널에 참가합니다.'),

  new SlashCommandBuilder()
    .setName('나가')
    .setDescription('음성채널에서 나갑니다.'),

  new SlashCommandBuilder()
    .setName('채널설정')
    .setDescription('tts 채널을 설정합니다.')
    .addChannelOption(option =>
      option.setName('채널')
        .setDescription('tts를 재생할 채널')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('채널해제')
    .setDescription('tts 채널을 해제합니다.'),
  
  new SlashCommandBuilder()
    .setName('목소리설정')
    .setDescription('목소리를 변경합니다.')
    .addStringOption(option =>
      option.setName('목소리')
        .setDescription('목소리')
        .addChoices(
          { name: '선히(여)', value: 'SunHiNeural' },
          { name: '인준(남)', value: 'InJoonNeural' },
          { name: '현수(남)', value: 'HyunsuNeural' },
          { name: '봉진(남)', value: 'BongJinNeural' },
          { name: '국민(남)', value: 'GookMinNeural' },
          { name: '지민(여)', value: 'JiMinNeural' },
          { name: '서현(여)', value: 'SeoHyeonNeural' },
          { name: '순복(여)', value: 'SoonBokNeural' },
          { name: '유진(여)', value: 'YuJinNeural' },
          { name: '현수(남) (다국어 지원)', value: 'HyunsuMultilingualNeural' },
        )
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('현재목소리')
    .setDescription('현재 설정 된 목소리를 확인합니다.'),

  new SlashCommandBuilder()
    .setName('속도설정')
    .setDescription('tts 속도를 변경합니다. (0: 느림, 100: 빠름)')
    .addIntegerOption(option =>
      option.setName('속도값')
        .setDescription('tts 속도')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('현재속도')
    .setDescription('현재 설정 된 tts 속도를 확인합니다.'),
      
  new SlashCommandBuilder()
    .setName('음소거')
    .setDescription('주희가 채팅을 치지 않도록 음소거합니다.'),
  
  new SlashCommandBuilder()
    .setName('음소거해제')
    .setDescription('주희의 음소거를 해제합니다.'),

  /**
   * 동시재생 기능 (현재 비활성화)
   * 여러 사람의 TTS를 동시에 재생하는 기능
   */
  // new SlashCommandBuilder()
  //   .setName('동시재생')
  //   .setDescription('여러 사람의 메시지를 동시에 TTS로 재생합니다.')
  //   .addBooleanOption(option =>
  //     option.setName('활성화')
  //       .setDescription('동시 재생 기능을 활성화/비활성화')
  //       .setRequired(true)),

  // new SlashCommandBuilder()
  //   .setName('믹서상태')
  //   .setDescription('현재 동시재생 믹서 상태를 확인합니다.'),

  /**
   * 도움말 명령 (미구현)
   */
  // new SlashCommandBuilder()
  //   .setName('도움말')
  //   .setDescription('도움말을 표시합니다.'),

];

export default Commands;