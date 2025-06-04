import { Client, EmbedBuilder, Guild, PartialGroupDMChannel } from "discord.js";
import dotenv from "dotenv";
dotenv.config();
const REQUEST_PASSWORD: string = process.env.REQUEST_PASSWORD ?? "";

import http from "http";
import { Servers } from "./dbObject.js";
import { DATA } from "./types.js";

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
