import { respondWithJSON } from "./json";
import { randomBytes } from "crypto";
import { type ApiConfig } from "../config";
import { type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "path";

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

	await cfg.s3Client
		.file(`${aspect}/${fileName}`)
		.write(bunFile, { type: video.type });

	const videoUrl = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${aspect}/${fileName}`;
	console.log(videoUrl);
	videoMetaData.videoURL = videoUrl;
	updateVideo(cfg.db, videoMetaData);

	return respondWithJSON(200, videoMetaData);
}

async function processVideoForFastStart(filePath: string) {
	const fileData = path.parse(filePath);
	const processedFile = path.join(
		fileData.dir,
		fileData.name + ".processed" + fileData.ext
	);

	console.log(processedFile);

	const proc = Bun.spawn([
		"ffmpeg",
		"-i",
		filePath,
		"-movflags",
		"faststart",
		"-map_metadata",
		"0",
		"-codec",
		"copy",
		"-f",
		"mp4",
		processedFile,
	]);

	await proc.exited;

	return processedFile;
}

async function getVideoAspectRatio(filePath: string) {
	const process = Bun.spawn(
		[
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"json",
			filePath,
		],
		{
			stdout: "pipe",
			stderr: "inherit",
		}
	);

	if ((await process.exited) !== 0) {
		throw new Error("process failed");
	}

	const result = await new Response(process.stdout).json();

	const { width, height } = result.streams[0];

	// landscape = 16 : 9 		portrait = 9 : 16
	// video = 1280 : 720		video = 720 : 1280
	// range = (1.60, 1.80)		range = (0.5, 0.6)

	const ratio = width / height;

	let aspectRatio = "other";

	if (ratio > 1.6 && ratio < 1.8) {
		aspectRatio = "landscape";
	}

	if (ratio > 0.5 && ratio < 0.6) {
		aspectRatio = "portrait";
	}

	return aspectRatio;
}
