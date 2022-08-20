import { getStroke, getStrokeOutlinePoints } from "./libraries/perfect-freehand.js"

//========//
// USEFUL //
//========//
const clamp = (n, min, max) => {
	if (n < min) return min
	if (n > max) return max
	return n
}

//=========//
// PAINTER //
//=========//
const makePainter = ({
	sources,
	offsetX = 0,
	offsetY = 0,
	centerX = 0.5,
	centerY = 0.5,
	scale = 1.0,
	speed = 0.1,
	maxSpeed = speed,
	minSpeed = maxSpeed * 0.3,
	acceleration = 0.001,
	dr = 0.05,
	frameRate = 24,
	speedR = 1.0,
	idleFadePower = 1.0,
	idleFrequency = { x: 500, y: 750 },
	strokeOptions = {},
} = {}) => {

	const images = []
	for (const source of sources) {
		const image = new Image()
		image.src = source
		images.push(image)
	}

	const painter = {
		images,
		frame: 0,
		frameRate,
		age: 0,
		scale,
		x: 0,
		y: 0,
		dx: 0,
		dy: 0,
		dr,
		offsetX,
		offsetY,
		centerX,
		centerY,
		speed,
		maxSpeed,
		minSpeed,
		acceleration,
		isPainting: false,
		brushdx: 0,
		brushdy: 0,
		r: 0,
		targetR: 0,
		speedR,
		idleFadePower,
		idleFrequency,
		strokeOptions,
	}
	return painter
}

const drawPainter = (context, painter) => {
	const {images, frame, scale, r} = painter
	const image = images[frame]
	const [width, height] = ["width", "height"].map(dimension => image[dimension] * scale)

	const center = {x: painter.x + width * painter.centerX, y: painter.y + height * painter.centerY}

	context.translate(center.x, center.y)
	context.rotate(r)
	context.drawImage(image, -width * painter.centerX, -height * painter.centerY, width, height)
	context.rotate(-r)
	context.translate(-center.x, -center.y)
}

// https://stackoverflow.com/questions/17410809/how-to-calculate-rotation-in-2d-in-javascript
function rotatePoint (cx, cy, x, y, angle) {
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)
    const nx = (cos * (x - cx)) + (sin * (y - cy)) + cx
    const ny = (cos * (y - cy)) - (sin * (x - cx)) + cy
    return {x: nx, y: ny}
}

const getBrushPosition = (painter) => {
	const image = painter.images[painter.frame]
	const x = painter.x - painter.offsetX * painter.scale
	const y = painter.y - painter.offsetY * painter.scale
	const cx = painter.x + image.width*painter.centerX * painter.scale
	const cy = painter.y + image.height*painter.centerY * painter.scale
	return rotatePoint(cx, cy, x, y, painter.r)
}

let lastBrushWasTouch = false
let restingPosition = [0, 0]
on.mousemove(() => restingPosition = Mouse.position.map(v => v * devicePixelRatio / (window.shrinkScore)))
on.touchstart(e => e.preventDefault(), {passive: false})

const updatePainter = (context, painter, paths, colour) => {

	if (painter.isPainting) {
		painter.idleFadePower -= 0.01
	} else {
		painter.idleFadePower += 0.01
	}
	
	painter.idleFadePower = clamp(painter.idleFadePower, 0.0, 1.0)

	painter.age++
	if (painter.age > 255) {
		painter.age = 0
	}
	if (painter.age % (60 / painter.frameRate) === 0) {
		painter.frame++
		if (painter.frame >= painter.images.length) {
			painter.frame = 0
		}
	}

	const acceleration = painter.acceleration * (Mouse.Right? -1 : 1)
	painter.speed = clamp(painter.speed + acceleration, painter.minSpeed, painter.maxSpeed)

	const brush = getBrushPosition(painter)

	let [mx, my] = restingPosition
	if (Touches.length > 0) {
		lastBrushWasTouch = true
		const [touch] = Touches
		restingPosition = touch.position.map(v => v * devicePixelRatio / (window.shrinkScore))
		;[mx, my] = restingPosition
	}

	if (Mouse.Left) lastBrushWasTouch = false

	if (!lastBrushWasTouch && mx !== undefined) {
		my -= (context.canvas.height - my)/3
		mx -= (context.canvas.width - mx)/3
	}
	const mouse = {x: mx, y: my}

	if (Mouse.Left || Touches.length > 0) {
		if (!painter.isPainting) {
			
			let isCloseEnough = true
			if (Touches.length > 0) {
				const displacement = [mx - painter.x, my - painter.y]
				const distance = Math.hypot(...displacement)
				if (distance > 50) isCloseEnough = false
			}

			if (isCloseEnough) {
				painter.isPainting = true
				const path = []
				paths.push(path)
				path.colour = colour
				path.push([brush.x, brush.y])
			}
		}
	} else {
		painter.isPainting = false
	}

	for (const position of ["x", "y"]) {
		const speed = `d${position}`
		if (mouse[position] === undefined) continue
		painter[speed] = (mouse[position] - painter[position]) * painter.speed
		painter[position] += painter[speed]
	}
	
	global.painter.x += (2*Math.sin(performance.now() / global.painter.idleFrequency.x)) * global.painter.idleFadePower
	global.painter.y += (2*Math.sin(performance.now() / global.painter.idleFrequency.y)) * global.painter.idleFadePower

	painter.targetR = painter.dx * painter.dr + painter.dy * -painter.dr
	painter.r += (painter.targetR - painter.r) * painter.speedR

	const newBrush = getBrushPosition(painter)

	painter.brushdx = newBrush.x - brush.x
	painter.brushdy = newBrush.y - brush.y
	
	if (painter.isPainting) {
		const path = paths.last
		path.push([newBrush.x, newBrush.y])
	}

}

//======//
// PATH //
//======//
const drawPaths = (context, painter, paths) => {
	//context.lineWidth = 250
	context.lineWidth = 10
	context.lineCap = "round"
	for (let i = 0; i < paths.length; i++) {
		let path = paths[i]

		if (!(path instanceof Path2D)) {
			const stroke = getStroke(path, painter.strokeOptions)
			const [head, ...tail] = getSmootherStroke(stroke, 3)

			const strokePath = new Path2D()
			if (!painter.isPainting || path !== paths.last) {
				paths[i] = strokePath
			}

			strokePath.moveTo(...head)
			for (const [x, y] of tail) {
				strokePath.lineTo(x, y)
			}
			
			strokePath.colour = path.colour
			path = strokePath
		}

		//context.strokeStyle = path.colour
		//context.stroke(path)

		context.fillStyle = path.colour
		context.fill(path)
	}
}

const getSmootherStroke = (stroke, iterations = 1) => {
	const [head] = stroke
	const smootherStroke = [head]
	for (let i = 1; i < stroke.length; i++) {

		let previous = stroke[i-1]
		const point = stroke[i]
		let next = stroke[i+1]
		
		if (previous === undefined) previous = point
		if (next === undefined) next = point

		const [px, py] = previous
		const [x, y] = point
		const [nx, ny] = next

		const points = [
			[px*3+x*2+nx, py*3+y*2+ny].map(v => v/6),
			[px+x+nx, py+y+ny].map(v => v/3),
			[px+x*2+nx*3, py+y*2+ny*3].map(v => v/6),

		]
		
		smootherStroke.push(...points)
	}

	iterations--
	if (iterations > 0) return getSmootherStroke(smootherStroke, iterations)

	return smootherStroke
}

//--------------------- NO GLOBAL STATE ABOVE THIS LINE ---------------------//

//==========//
// PAINTERS //
//==========//
const berd = makePainter({
	sources: ["images/berd0.png", "images/berd1.png"],
	scale: 0.5,
	centerY: 0.35,
	centerX: 0.55,
	offsetX: -25,
	offsetY: -107.5,
	speed: 0.1,
	minSpeed: 0.035,
	maxSpeed: 0.2,
	dr: 0.05,
	speedR: 0.1,
	acceleration: 0.0002,
	strokeOptions: {
		smoothing: 1.0,
		streamline: 0.6,
		thinning: 0.5,
		last: true,
	},
})

const tode = makePainter({
	sources: ["images/tode.png"],
	scale: 0.5,
	centerY: 0.35,
	centerX: 0.55,
	offsetX: -0,
	offsetY: -70,
	speed: 0.09,
	minSpeed: 0.01,
	maxSpeed: 0.15,
	dr: 0.05,
	speedR: 0.05,
	acceleration: 0.00001,
	strokeOptions: berd.strokeOptions,
})

const painters = [berd, tode]

//==============//
// GLOBAL STATE //
//==============//
const global = {
	painterId: 0,
	painter: painters[0],
	paths: [],
	colour: Colour.White,
}

window.global = global

//======//
// SHOW //
//======//
const show = Show.make()

//const BLUE_SCREEN_COLOUR = Colour.multiply(Colour.Green, {lightness: 0.5})
const BLUE_SCREEN_COLOUR = Colour.Black
show.resize = (context) => {
	context.canvas.style["background-color"] = BLUE_SCREEN_COLOUR
	context.canvas.style["cursor"] = "none"
}

show.tick = (context) => {
	const {canvas} = context
	context.clearRect(0, 0, canvas.width, canvas.height)
	updatePainter(context, global.painter, global.paths, global.colour)
	drawPaths(context, global.painter, global.paths)
	drawPainter(context, global.painter)
}

on.load(() => trigger("resize"))

//=======//
// EVENT //
//=======//
on.contextmenu(e => e.preventDefault(), {passive: false})

const KEYDOWN = {}
on.keydown(e => {
	const func = KEYDOWN[e.key]
	if (func === undefined) return
	func(e)
})

KEYDOWN["x"] = () => {
	global.paths.pop()
	if (global.painter.isPainting) {
		global.painter.isPainting = false
	}
}

KEYDOWN["r"] = () => {
	global.paths = []
	global.painter.isPainting = false
}

KEYDOWN["c"] = KEYDOWN["r"]

KEYDOWN["1"] = () => global.colour = Colour.White
KEYDOWN["2"] = () => global.colour = Colour.Red
KEYDOWN["3"] = () => global.colour = Colour.Green
KEYDOWN["4"] = () => global.colour = Colour.Blue
KEYDOWN["5"] = () => global.colour = Colour.Yellow
KEYDOWN["6"] = () => global.colour = Colour.Orange
KEYDOWN["7"] = () => global.colour = Colour.Pink
KEYDOWN["8"] = () => global.colour = Colour.Rose
KEYDOWN["9"] = () => global.colour = Colour.Cyan
KEYDOWN["0"] = () => global.colour = Colour.Purple

KEYDOWN["Tab"] = (e) => {
	global.painterId++
	if (global.painterId >= painters.length) {
		global.painterId = 0
	}
	global.painter = painters[global.painterId]
	e.preventDefault()
}
