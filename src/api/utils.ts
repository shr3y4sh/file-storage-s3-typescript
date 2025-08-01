import path from "path";

export async function processVideoForFastStart(filePath: string) {
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

export async function getVideoAspectRatio(filePath: string) {
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
