import { Client, EmbedBuilder, Guild, PartialGroupDMChannel } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
const REQUEST_PASSWORD: string = process.env.REQUEST_PASSWORD ?? "";
const JUHEE_URL: string = process.env.JUHEE_URL ?? "";

import http from "http";
import { JoinedServer, Servers, Users } from "./dbObject.js";
import { DATA } from "./types.js";


import { Console } from "node:console";
import { Transform } from "node:stream";
import path from "node:path";
import fs from "node:fs";

const ts: Transform = new Transform({
  transform(chunk, enc, cb) {
    cb(null, chunk);
  },
});
const logger = new Console({ stdout: ts });

function getTable(data: any) {
  logger.table(data);
  return (ts.read() || "").toString();
}

export let recognizeOption = false;

export default class HttpServer {
  private server: http.Server;
  private client: Client;

  private async notice(data: EmbedBuilder) {
    await Servers.sync();
    const servers: DATA[] = await Servers.findAll();
    for (const server of servers) {
      const ttsChannel = server.dataValues.ttsChannel;
      // if(ttsChannel && server.dataValues.id == '1215573434159996948') {
      // if(ttsChannel && server.dataValues.id == '1119640137580675103') {
      if (ttsChannel) {
        this.client.channels
          .fetch(ttsChannel)
          .then((channel) => {
            if (
              channel?.isTextBased() &&
              !(channel instanceof PartialGroupDMChannel)
            ) {
              try {
                channel.send({ embeds: [data] });
              } catch (e) {
                console.log(e);
              }
            }
          })
          .catch((e) => {
            console.log(e);
          });
      }
    }
  }

  private async status(): Promise<String> {
    const servers = await Servers.findAll();
    const users = await Users.findAll();
    const joinedServers = await JoinedServer.findAll();

    const result = async () => {
      const serverData = await Promise.all(
        servers.map(async (server) => {
          try {
            const serverInstance = await this.client.guilds.fetch(
              server.dataValues.id
            );
            return { id: server.dataValues.id, name: serverInstance.name };
          } catch (error) {
            return { id: server.dataValues.id, name: "알 수 없음" };
          }
        })
      );

      const userData = await Promise.all(
        users.map(async (user) => {
          const userInstance = await this.client.users.fetch(
            user.dataValues.id
          );
          return {
            id: user.dataValues.id,
            globalName: userInstance.globalName || "-",
            displayName: userInstance.displayName,
            username: userInstance.username,
          };
        })
      );

      const joinData = await Promise.all(
        joinedServers.map(async (joined) => {
          try {
            const serverInstance = await this.client.guilds.fetch(
              joined.dataValues.server_id
            );
            const userInstance = await this.client.users.fetch(
              joined.dataValues.user_id
            );
            const memberInstance = await serverInstance.members.fetch(
              joined.dataValues.user_id
            );
            return {
              server_id: joined.dataValues.server_id,
              server_name: serverInstance.name,
              user_id: joined.dataValues.user_id,
              username: userInstance.username,
              member_displayName: memberInstance.displayName,
            };
          } catch (error) {
            return {
              server_id: joined.dataValues.server_id,
              server_name: "알 수 없음",
              user_id: joined.dataValues.user_id,
              username: "알 수 없음",
              member_displayName: "알 수 없음",
            };
          }
        })
      );

      const output =
        "[ 서버 정보 ]\n" +
        getTable(serverData) +
        "\n[ 사용자 정보 ]\n" +
        getTable(userData) +
        "\n[ 서버-사용자 연결 정보 ]\n" +
        getTable(joinData);

      return output;
    };

    const timestamp = Date.now();
    const filename = `status_${timestamp}.txt`;
    const filepath = path.join(process.cwd(), "public", "status", filename);

    // Ensure public directory exists
    fs.mkdirSync(path.join(process.cwd(), "public", "status"), {
      recursive: true,
    });

    // Write result to file
    fs.writeFileSync(filepath, await result());

    // Get public URL (assuming your server is running on port 3000)
    const publicUrl = `${JUHEE_URL}:8080/status/${filename}`;

    return publicUrl;
  }

  private requestHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    if (req.url === "/notice" && req.method === "POST") {
      let postData: string = "";
      req.on("data", (data) => {
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData.split(",")[0];
        postData = postData.split(",").slice(1).join(",");
        postData = postData.replace(/\\n/g, "\n");
        const title: string = postData.split("\n")[0];
        postData = postData.replace(title + "\n", "");
        if (
          password.startsWith("password=") &&
          password.split("=")[1] === REQUEST_PASSWORD
        ) {
          const embed = new EmbedBuilder()
            .setColor("#9A8ED7")
            .setTitle(title)
            .setDescription(postData)
            .setFooter({
              text: "주희봇 ⓒ 2024. @kevin1113dev All Rights Reserved.",
              iconURL:
                "https://github.com/kevin1113-github/juhee-bot/blob/master/juhee-profile.png?raw=true",
            });

          await this.notice(embed);
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.write("OK");
        res.end();
      });
    } else if (req.url === "/toggleRecognize" && req.method === "POST") {
      let postData: string = "";
      req.on("data", (data) => {
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData;
        if (
          password.startsWith("password=") &&
          password.split("=")[1] === REQUEST_PASSWORD
        ) {
          recognizeOption = !recognizeOption;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write(recognizeOption ? "recognizeOption is enabled." : "recognizeOption is disabled.");
          res.end();
        }
        else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write("error");
          res.end();
        }
      });
    } else if (req.url === "/status" && req.method === "POST") {
      let postData: string = "";
      req.on("data", (data) => {
        postData += typeof data === "string" ? data : data.toString();
      });
      req.on("end", async () => {
        const password = postData;
        if (
          password.startsWith("password=") &&
          password.split("=")[1] === REQUEST_PASSWORD
        ) {
          const statusUrl = await this.status();
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write(statusUrl);
          res.end();
        }
        else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.write("error");
          res.end();
        }
      });
    } else if (req.url?.startsWith('/status/') && req.method === "GET") {
      const filePath = path.join(process.cwd(), 'public', req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('File not found');
          return;
        }
        res.writeHead(200);
        res.end(data);
      });
    } else {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.write("<h1>404 Not Found</h1>");
      res.end();
    }
  };

  constructor(client: Client) {
    this.server = http.createServer(this.requestHandler);
    this.client = client;
  }

  start() {
    this.server.listen(8080, () => {
      console.log("Server is running on 8080 port");
    });
  }

  stop() {
    this.server.close(() => {
      console.log("Server is closed");
    });
  }
}
