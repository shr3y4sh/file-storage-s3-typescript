import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import path from "path";
import { randomBytes } from "crypto";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
	const { videoId } = req.params as { videoId?: string };
	if (!videoId) {
		throw new BadRequestError("Invalid video ID");
	}

	const token = getBearerToken(req.headers);
	const userID = validateJWT(token, cfg.jwtSecret);

	console.log("uploading thumbnail for video", videoId, "by user", userID);

	// /TODO: implement the upload here
	const formData = await req.formData();

	const thumbnail = formData.get("thumbnail");

	if (!(thumbnail instanceof File)) {
		throw new BadRequestError("Thumbnail is not a file object");
	}

	console.log(thumbnail.type);

	if (thumbnail.type !== "image/jpeg" && thumbnail.type !== "image/png") {
		throw new BadRequestError("Invalid Mime type");
	}

	const MAX_UPLOAD_SIZE = 10 << 20;

	if (thumbnail.size > MAX_UPLOAD_SIZE) {
		throw new BadRequestError("Size is too large");
	}

	const fileExt = thumbnail.type.split("/")[1];

	const fileName = `${randomBytes(32).toString("base64")}.${fileExt}`;

	const fileLocation = path.join(cfg.assetsRoot, fileName);

	await Bun.write(fileLocation, thumbnail);

	const dataUrl = `http://localhost:${cfg.port}/assets/${fileName}`;

	let video = getVideo(cfg.db, videoId);

	if (video?.userID !== userID) {
		throw new UserForbiddenError("Userid doesn't match");
	}

	video.thumbnailURL = dataUrl;

	updateVideo(cfg.db, video);

	return respondWithJSON(200, video);
}
