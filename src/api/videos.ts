import { respondWithJSON } from "./json";
import { randomBytes } from "crypto";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "path";
import { processVideoForFastStart, getVideoAspectRatio } from "./utils";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
	const MAX_VIDEO_SIZE = 1 << 30;

	const { videoId } = req.params as { videoId?: string };
	if (!videoId) {
		throw new BadRequestError("Video Id not valid");
	}

	const token = getBearerToken(req.headers);
	const userID = validateJWT(token, cfg.jwtSecret);

	const videoMetaData = getVideo(cfg.db, videoId);
	if (videoMetaData?.userID !== userID) {
		throw new UserForbiddenError("Video doesn't belong to the user");
	}

	const formData = await req.formData();

	const video = formData.get("video");
	if (!(video instanceof File)) {
		throw new BadRequestError("Video is not a file object");
	}

	if (video.type !== "video/mp4") {
		throw new BadRequestError("Invalid Mime type");
	}

	if (video.size > MAX_VIDEO_SIZE) {
		throw new BadRequestError("Size is to large. Max size allowed: 1Gb");
	}

	let fileName = `${randomBytes(32).toString("hex")}.${
		video.type.split("/")[1]
	}`;

	const inputFile = path.join("/tmp", fileName);

	await Bun.write(inputFile, video);

	const outputFile = await processVideoForFastStart(inputFile);
	const bunFile = Bun.file(outputFile);

	const { name, ext } = path.parse(outputFile);

	fileName = `${name}${ext}`;

	const aspect = await getVideoAspectRatio(outputFile);
	const videoUrl = `${aspect}/${fileName}`;

	// await cfg.s3Client.file(videoUrl).write(bunFile, { type: video.type });

	// const videoUrl =
	// 	"portrait/68152fd6f36cc5fe984cfea2c5434cbc071ac2230d05e78f1cc244fb120f2302.processed.mp4";

	videoMetaData.videoURL = cfg.s3CfDistribution + "/" + videoUrl;

	console.log(videoMetaData.videoURL);

	updateVideo(cfg.db, videoMetaData);

	return respondWithJSON(200, videoMetaData);
}
