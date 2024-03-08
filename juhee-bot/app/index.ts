import dotenv from "dotenv";
dotenv.config();
const TOKEN: string = process.env.TOKEN ?? '';
const CLIENT_ID: string = process.env.CLIENT_ID ?? '';
// console.log(TOKEN, CLIENT_ID);

import { __dirname } from './const.js';


import { REST, Routes, Client, GatewayIntentBits, MessageType, Events, Interaction, GuildMember } from 'discord.js';
import { getVoiceConnection, createAudioPlayer, NoSubscriberBehavior, createAudioResource, StreamType, AudioPlayer, AudioPlayerStatus, VoiceConnection } from '@discordjs/voice';
import { PassThrough } from "stream";

// custom import
import msTTS from './msTTS.js';
import Commands  from './commands.js';
import { RegisterUser, RegisterUserMsg } from "./dbFunction.js";
import { JoinedServer, Servers, Users } from "./dbObject.js";
import Action from "./action.js";
import { DATA, GuildData } from "./types.js";

const guildDataList: GuildData[] = [];

// Reloading (/) commands.
const rest = new REST({ version: '10' }).setToken(TOKEN);
try {
  console.log('앱 명령어 새로고침 중...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: Commands });
  console.log('앱 명령어 불러오기 성공!');
} catch (error) {
  console.error(error);
}

// When bot is ready.
const client = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ] });
client.once(Events.ClientReady, async () => {
  // TODO: DB 불러오기
  await Servers.sync();
  await Users.sync();
  await JoinedServer.sync();

  const servers = await Servers.findAll();
  for (const server of servers) {
    guildDataList.push({ guildId: server.dataValues.id, audioPlayer: null, action: new Action(), timeOut: null });
  }
  console.log(`${client.user?.tag} 로그인 성공!`);
});

// When bot received interaction.
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    if (!interaction.guildId) {
      await interaction.reply('서버에서 사용해주세요.');
      return;
    }
    
    // register user
    await RegisterUser(interaction);
    // get nickname
    const NICKNAME: string = getNickName(interaction);

    // get server data
    const server: DATA | null = await Servers.findOne({ where: { id: interaction.guildId } });
    if (!server) {
      console.error('서버가 등록되지 않았습니다.');
      return;
    }

    // console.log(guildDataList);

    // get guild data
    let guildData: GuildData | undefined = guildDataList.find(data => data.guildId == interaction.guildId);
    if (!guildData) {
      guildData = { guildId: interaction.guildId, audioPlayer: null, action: new Action(interaction), timeOut: null };
      guildDataList.push(guildData);
    }
    else {
      guildData.action.setInteraction(interaction);
    }
    
    if (interaction.commandName === '들어와') {
      // 새로운 오디오 플레이어로 접속
      const audioPlayer = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });
      guildData.audioPlayer = audioPlayer;
      await guildData.action.joinVoiceChannel(audioPlayer);
    }

    // if (interaction.commandName === '주희야') {
    //   guildData.action.listen();
    // }
    
    if (interaction.commandName === '나가') {
      guildData.audioPlayer = null;
      await guildData.action.exitVoiceChannel();
    }

    if (interaction.commandName === '채널설정') {
      const channelId: string | undefined = interaction.options.getChannel('채널')?.id;
      if (!channelId) {
        await guildData.action.reply(`tts 채널이 설정되지 않았습니다.`);
        return;
      }

      await server.update({ ttsChannel: channelId });
      await guildData.action.reply(`[${(await interaction.guild?.channels.fetch(channelId))?.name}] 채널이 tts 채널로 설정되었습니다.`);
    }

    if (interaction.commandName === '채널해제') {
      const channelId = server.dataValues.ttsChannel;
      if (!channelId) {
        await guildData.action.reply(`tts 채널이 설정되지 않았습니다.`);
        return;
      }

      await server.update({ ttsChannel: null });
      await guildData.action.reply(`tts 채널이 해제되었습니다.`);
    }

    if (interaction.commandName === '목소리설정') {
      const voice: string = interaction.options.getString('목소리') ?? 'SeoHyeonNeural';

      const user: DATA | null = await Users.findOne({ where: { id: interaction.user.id } });
      if (!user) {
        await guildData.action.reply(`유저가 등록되지 않았습니다.`);
        return;
      }

      await user.update({ ttsVoice: voice });
      await guildData.action.reply(`목소리가 변경되었습니다.`);
    }

    if (interaction.commandName === '속도설정') {
      const speed: number = interaction.options.getInteger('속도값') ?? 0;

      const user: DATA | null = await Users.findOne({ where: { id: interaction.user.id } });
      if (!user) {
        await guildData.action.reply(`유저가 등록되지 않았습니다.`);
        return;
      }

      await user.update({ speed: speed });
      await guildData.action.reply(`속도가 변경되었습니다.`);
    }

    if (interaction.commandName === '음소거') {
      await server.update({ isMuted: true });
      await guildData.action.reply(`음소거 되었습니다.`);
    }

    if (interaction.commandName === '음소거해제') {
      await server.update({ isMuted: false });
      await guildData.action.reply(`음소거 해제되었습니다.`);
    }

    // 슬래시 커맨드 사용시 아무 응답을 하지 않았을 경우 오류 응답 처리
    if(!guildData.action.isReplied) {
      await guildData.action.reply(`예기치 못한 오류 발생. 개발자에게 문의해주세요.`);
      return;
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
	// 봇이 보낸 메세지 또는 텍스트 메세지가 아니면 반응 안함.
	if (message.author.bot || !(message.type == MessageType.Default || message.type == MessageType.Reply)
    || !message.inGuild() || !message.member) {
    // console.log('봇이 보낸 메세지 또는 텍스트 메세지가 아니면 반응 안함.');
    return;
  }

  // get guild data
  let guildData: GuildData | undefined = guildDataList.find(data => data.guildId == message.guildId);
  if (!guildData) {
    guildData = { guildId: message.guildId, audioPlayer: null, action: new Action(message), timeOut: null};
    guildDataList.push(guildData);
  }
  else {
    guildData.action.setInteraction(message);
  }

  // get server data
  const server: DATA | null = await Servers.findOne({ where: { id: message.guildId } });
  if (!server) return;

	const ttsChannel = server.dataValues.ttsChannel;
  // console.log(message.content, ttsChannel);

	if (message.channelId == ttsChannel && ((message.member.voice.channelId == getVoiceConnection(message.guildId)?.joinConfig.channelId) || !getVoiceConnection(message.guildId))) {
    await RegisterUserMsg(message);

    const user: DATA | null = await Users.findOne({ where: { id: message.author.id } });
    if (!user) return;

		let audioPlayer: AudioPlayer | null = guildData.audioPlayer;
    if (audioPlayer && audioPlayer.state.status == AudioPlayerStatus.Playing) {
      await guildData.action.reply('이미 tts가 재생중입니다.');
      return;
    }

    if (!audioPlayer) {
      audioPlayer = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });
      guildData.audioPlayer = audioPlayer;
    }

		if (!getVoiceConnection(message.guildId)) {
			await guildData.action.joinVoiceChannel(audioPlayer);
		}

    msTTS(parseMessage(message.content), (stream: PassThrough) => {
      // console.log(stream);
      const resource = createAudioResource(stream, { inputType: StreamType.OggOpus });
      audioPlayer?.play(resource);
    } , user.dataValues.ttsVoice, user.dataValues.speed);


    if (guildData.timeOut) {
      clearTimeout(guildData.timeOut);
    }

    const timeOut: NodeJS.Timeout = setTimeout(async () => {
      if (!getVoiceConnection(message.guildId))
        return;
      // const guildData = guildDataList.find(data => data.guildId == message.guildId);
      if (guildData) {
        guildData.audioPlayer?.stop();
        guildData.audioPlayer = null;
        getVoiceConnection(message.guildId)?.destroy();
        await guildData?.action.send('tts가 종료되었습니다.');
      }
    }, 1800_000);
    guildData.timeOut = timeOut;

		// if (message.content == '주희야') {
		// 	guildData.action.listen();
		// }
	}
});

client.login(TOKEN);

function parseMessage(messageContent: string) {
	if (messageContent == 'ㅋㅋ')
		return '크크';
	else if (messageContent == 'ㅋㅋㅋ')
		return '크크크';
  else if (messageContent == 'ㅎㅇ')
    return '하이';
  else if (messageContent == 'ㅃㅃ')
		return '빠빠이';
  else if (messageContent == 'ㄷㄷ')
    return '덜덜';
	// console.log(messageContent);
	const mentionReg = new RegExp(/<@([0-9]{3,})>/, "g");
	const roleReg = new RegExp(/<@&([0-9]{3,})>/, "g");
	const channelReg = new RegExp(/<#([0-9]{3,})>/, "g");
	const urlReg = new RegExp(/http[s]?:\/\/([\S]{3,})/, "g");

  const byeReg = new RegExp(/ㅃㅃ\s/, "g");
  const lolReg = new RegExp(/(ㅋ{3,})/, "g");
	const dotReg = new RegExp(/(\.{2,})/, "g");
	
	messageContent = (messageContent.replace(mentionReg, " 멘션 "));
	messageContent = (messageContent.replace(roleReg, " 역할 "));
	messageContent = (messageContent.replace(channelReg, " 채널 "));
	messageContent = (messageContent.replace(urlReg, " 링크 "));
	messageContent = (messageContent.replace(byeReg, " 빠빠 "));
	messageContent = (messageContent.replace(lolReg, " 크크크 "));
	messageContent = (messageContent.replace(dotReg, " "));

	return messageContent;
}

function getNickName(interaction: Interaction): string {
  const name: string = interaction.user.globalName || interaction.user.username;
  return interaction.member instanceof GuildMember ? interaction.member.nickname || name : name;
}
