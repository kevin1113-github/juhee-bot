import { ChannelType, SlashCommandBuilder } from 'discord.js';

const Commands: SlashCommandBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">[] = [
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
          { name: '봉진(남)', value: 'BongJinNeural' },
          { name: '국민(남)', value: 'GookMinNeural' },
          { name: '현수(남)', value: 'HyunsuNeural' },
          { name: '지민(여)', value: 'JiMinNeural' },
          { name: '서현(여)', value: 'SeoHyeonNeural' },
          { name: '순복(여)', value: 'SoonBokNeural' },
          { name: '유진(여)', value: 'YuJinNeural' },
        )
        .setRequired(true)),

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
    .setName('음소거')
    .setDescription('주희가 채팅을 치지 않도록 음소거합니다.'),
  
  new SlashCommandBuilder()
    .setName('음소거해제')
    .setDescription('주희의 음소거를 해제합니다.'),

  // new SlashCommandBuilder()
  //   .setName('주희야')
  //   .setDescription('음성을 인식하여 노래를 플레이합니다.'),
      
];

export default Commands;