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

	const images = sources.map(() => {
		const image = document.createElementNS("http://www.w3.org/2000/svg", "image")
		image.style.visibility = "hidden"
		return image
	})

	const ready = (async () => {
		const c = document.createElement("canvas");
		const ctx = c.getContext("2d");

		// A promise that awaits the loading of all resources before resolving.
		await Promise.all(sources.map(async (src, i) => {
			const img = new Image()
			img.crossOrigin = ""
			img.src = src
			img.loading = "eager"
			if (!img.complete) {
				await new Promise((resolve, reject) => {
					img.addEventListener('load', () => {
						c.width = img.naturalWidth;     // update canvas size to match image
						c.height = img.naturalHeight;
						ctx.drawImage(img, 0, 0);       // draw in image
						const image = images[i]
						image.setAttribute("width", img.width * scale)
						image.setAttribute("height", img.height * scale)
						image.setAttribute('href', c.toDataURL()) // update image with new data
						resolve()
					})
					img.addEventListener('error', reject)
				})
			}
		}))
	})()

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
		ready,
	}

	return painter
}

const drawPainter = (painter) => {
	const {images, frame, r} = painter
	const image = images[frame]
	const width = image.width.baseVal.value
	const height = image.height.baseVal.value
	const cx = painter.x + width * painter.centerX
	const cy = painter.y + height * painter.centerY

	image.setAttribute("x", cx - width/2)
	image.setAttribute("y", cy - height/2)
	image.setAttribute("transform", `rotate(${r * 180 / Math.PI}, ${cx}, ${cy})`)
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
	const width = image.width.baseVal.value
	const height = image.height.baseVal.value
	const x = painter.x - painter.offsetX * painter.scale
	const y = painter.y - painter.offsetY * painter.scale
	const cx = painter.x + width*painter.centerX
	const cy = painter.y + height*painter.centerY
	return rotatePoint(cx, cy, x, y, painter.r)
}

let lastBrushWasTouch = false
let restingPosition = [0, 0]
on.mousemove(() => restingPosition = Mouse.position.map(v => v * 1 / (window.shrinkScore)))
on.touchstart(e => e.preventDefault(), {passive: false})

const updatePainter = (layers, strokeHistoryContainer, currentStrokeContainer, painter, paths, colour) => {
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
		painter.images[painter.frame].style.visibility = "hidden"
		painter.frame++
		if (painter.frame >= painter.images.length) {
			painter.frame = 0
		}
		painter.images[painter.frame].style.visibility = "visible"
	}

	const acceleration = painter.acceleration * (Mouse.Right? -1 : 1)
	painter.speed = clamp(painter.speed + acceleration, painter.minSpeed, painter.maxSpeed)

	const brush = getBrushPosition(painter)

	let [mx, my] = restingPosition
	const touch = Touches.first
	if (touch) {
		lastBrushWasTouch = true
		restingPosition = touch.position.map(v => v * 1 / (window.shrinkScore))
		;[mx, my] = restingPosition
	}

	if (Mouse.Left) lastBrushWasTouch = false

	if (!lastBrushWasTouch && mx !== undefined) {
		my -= (layers.last.height.baseVal.value - my)/3
		mx -= (layers.last.width.baseVal.value - mx)/3
	} else if (mx !== undefined) {
		my -= 200
		mx -= 20
	}
	const mouse = {x: mx, y: my}

	if (Mouse.Left || touch) {
		if (!painter.isPainting) {
			let isCloseEnough = true
			if (touch) {
				const displacement = [mx - painter.x, my - painter.y]
				const distance = Math.hypot(...displacement)
				if (distance > 50) isCloseEnough = false
			}

			if (isCloseEnough) {
				painter.isPainting = true
				const path = []
				const element = document.createElementNS("http://www.w3.org/2000/svg", "path")
				path.element = element
				paths.push(path)
				path.colour = colour
				path.push([brush.x, brush.y])
				const stroke = getStroke(path, painter.strokeOptions)
				element.setAttribute("d", getSvgPathFromStroke(stroke))
				element.setAttribute("fill", path.colour)
				currentStrokeContainer.appendChild(element)
			}
		}
	} else if (painter.isPainting) {
		painter.isPainting = false
		strokeHistoryContainer.appendChild(paths.last.element)
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
		const last = path.last
		const secondLast = path[path.length - 2]
		if (secondLast === undefined || last === undefined) {			
			path.push([newBrush.x, newBrush.y])
			const stroke = getStroke(path, painter.strokeOptions)
			path.element.setAttribute("d", getSvgPathFromStroke(stroke))
			return
		}
		//const displacementLast = [newBrush.x - last[0], newBrush.y - last[1]]
		const displacementSecondLast = [newBrush.x - secondLast[0], newBrush.y - secondLast[1]]
		//const distanceLast = Math.hypot(...displacementLast)
		const distanceSecondLast = Math.hypot(...displacementSecondLast)
		if (distanceSecondLast <= 5.0) {
			path[path.length-1] = [newBrush.x, newBrush.y]
			const stroke = getStroke(path, painter.strokeOptions)
			path.element.setAttribute("d", getSvgPathFromStroke(stroke))
		} else {
			path.push([newBrush.x, newBrush.y])
			const stroke = getStroke(path, painter.strokeOptions)
			path.element.setAttribute("d", getSvgPathFromStroke(stroke))
		}
	}

}

//======//
// PATH //
//======//

function getSvgPathFromStroke(stroke) {
	if (!stroke.length) return ''

	const d = stroke.reduce(
		(acc, [x0, y0], i, arr) => {
			const [x1, y1] = arr[(i + 1) % arr.length]
			acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
			return acc
		},
		['M', ...stroke[0], 'Q']
	)

	d.push('Z')
	return d.join(' ')
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
	offsetX: -47,
	offsetY: -60,
	speed: 0.1,
	minSpeed: 0.035,
	maxSpeed: 0.2,
	dr: 0.05,
	speedR: 0.1,
	acceleration: 0.0002,
	strokeOptions: {
		smoothing: 1.0,
		streamline: 0.5,
		thinning: 0.5,
		last: true,
	},
})

const tode = makePainter({
	sources: ["images/tode.png"],
	scale: 0.5,
	centerY: 0.35,
	centerX: 0.55,
	offsetX: -35,
	offsetY: -17.5,
	speed: 0.09,
	minSpeed: 0.01,
	maxSpeed: 0.15,
	dr: 0.05,
	speedR: 0.05,
	acceleration: 0.00001,
	strokeOptions: berd.strokeOptions,
})

const painters = [berd, tode]

//======//
// SHOW //
//======//
const show = Show.make({ layerCount: 2 })


//==============//
// Picture Mode //
//==============//

const pictureMode = (() => {
	let listeners = null;
	let viewBoxX, viewBoxY, viewBoxW, viewBoxH;
	const dragLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg")
	const dragPath = document.createElementNS("http://www.w3.org/2000/svg", "path")
	dragLayer.style.cursor = 'crosshair'
	dragPath.setAttribute("fill", "#00000055")

	function renderToCanvas(transparentBg, { x, y, w, h }) {
		const canvas = document.createElement("canvas")
		canvas.width = w
		canvas.height = h
		const ctx = canvas.getContext("2d")
		ctx.clearRect(0, 0, w, h)
		const layers = show.layers
		return Promise.all(
			layers.map((layer, i) => {
				layer = layer.cloneNode(true);
				layer.setAttribute("xmlns", "http://www.w3.org/2000/svg")
				if (i === 0 && transparentBg) {
					layer.style['background-color'] = 'transparent'
				}
				const outerHTML = layer.outerHTML;
				const blob = new Blob([outerHTML], {type:'image/svg+xml;charset=utf-8'});
				const URL = window.URL || window.webkitURL || window;
				const blobURL = URL.createObjectURL(blob);
				const img = new Image();
				img.width = viewBoxW;
				img.height = viewBoxH;
				return new Promise((resolve, reject) => {
					img.src = blobURL;
					img.onload = () => resolve(img)
					img.onerror = reject
				})
			})
		).then(images => {
			images.forEach(img => ctx.drawImage(img, -x, -y, viewBoxW, viewBoxH))
		}).then(() => canvas)
	}

	const pm = {
		start(layers) {
			if (listeners) return
			Array.prototype.filter.call(layers.last.style, key => key != 'cursor').forEach(key => dragLayer.style[key] = layers.last.style[key]);
			[viewBoxX, viewBoxY, viewBoxW, viewBoxH] = layers.last.getAttributeNS("http://www.w3.org/2000/svg", "viewBox").split(" ").filter(x => x != "")
			dragLayer.setAttributeNS("http://www.w3.org/2000/svg", "viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`)
			let dragStart = null;
			let isDragging = false;
			let isRightClick = false;
			layers.last.insertAdjacentElement("afterend", dragLayer)
			listeners = [
				on.mousedown((e) => {
					// We need focus in order to have permission
					// to modify the clipboard.
					// On certain OS'es, focus is granted after
					// mouseup is fired
					if (dragStart || !document.hasFocus()) {
						isDragging = false
						dragStart = null
						dragPath.remove()
						return
					}
					isRightClick = e.button === 2
					dragStart = [e.clientX, e.clientY]
					isDragging = false
				}),
				on.mousemove((e) => {
					if (dragStart && !isDragging) {
						isDragging = true
						dragLayer.appendChild(dragPath)
					}
					if (isDragging) {
						const [x0, y0] = dragStart
						const [x1, y1] = [e.clientX, e.clientY]
						const minX = Math.min(x0, x1)
						const minY = Math.min(y0, y1)
						const maxX = Math.max(x0, x1)
						const maxY = Math.max(y0, y1)
						dragPath.setAttribute("d", `M0,0L${viewBoxW},0 ${viewBoxW},${viewBoxH} 0,${viewBoxH}M${minX},${minY}L${minX},${maxY} ${maxX},${maxY} ${maxX},${minY}Z`)
					}
				}),
				on.mouseup((e) => {
					if (!dragStart) return
					const canvas = document.createElement("canvas")
					canvas.width = viewBoxW
					canvas.height = viewBoxH
					let canvasPromise
					if (isDragging) {
						const from = dragStart;
						const to = [e.clientX, e.clientY];
						const minX = Math.min(from[0], to[0]);
						const minY = Math.min(from[1], to[1]);
						const maxX = Math.max(from[0], to[0]);
						const maxY = Math.max(from[1], to[1]);
						dragPath.remove()
						canvasPromise =  renderToCanvas(isRightClick, {
							x: minX,
							y: minY,
							w: maxX - minX,
							h: maxY - minY
						});
					} else {
						canvasPromise = renderToCanvas(isRightClick, {
							x: 0,
							y: 0,
							w: viewBoxW,
							h: viewBoxH,
						});
					}
					navigator.clipboard.write([
						new ClipboardItem({
							"image/png": canvasPromise.then(canvas => new Promise(resolve => canvas.toBlob(resolve))),
						})
					]).catch(console.error)
					dragStart = null
					isDragging = false
				}),
			]
		},
		resize(layers) {
			Array.prototype.filter.call(layers.last.style, key => key != 'cursor').forEach(key => dragLayer.style[key] = layers.last.style[key]);
			[viewBoxX, viewBoxY, viewBoxW, viewBoxH] = layers.last.getAttributeNS("http://www.w3.org/2000/svg", "viewBox").split(" ").filter(x => x != "")
			dragLayer.setAttributeNS("http://www.w3.org/2000/svg", "viewBox", `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`)
		},
		stop() {
			if (!listeners) return
			listeners.forEach(off => off())
			listeners = null
			dragLayer.remove()
		}
	}

	return pm
})()

//==============//
// GLOBAL STATE //
//==============//
const global = {
	painterId: 0,
	painter: painters[0],
	paths: [],
	colour: Colour.White,
	currentFrame: null,
	strokeHistoryContainer: show.layers.first.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "g")),
	currentStrokeContainer: show.layers.last.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "g")),
	painterContainer: show.layers.last.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "g")),
}

window.global = global


//const BLUE_SCREEN_COLOUR = Colour.multiply(Colour.Green, {lightness: 0.5})
const BLUE_SCREEN_COLOUR = Colour.Black
show.resize = (layers) => {
	layers.first.style["background-color"] = BLUE_SCREEN_COLOUR
	layers.forEach(layer => layer.style["cursor"] = "none")
	pictureMode.resize(layers)
}

show.tick = (layers) => {
	// Suspend redraw of the SVG image until all changes are made
	const suspendIds = layers.map(layer => [layer, layer.suspendRedraw(5000)])
	updatePainter(layers, global.strokeHistoryContainer, global.currentStrokeContainer, global.painter, global.paths, global.colour)
	drawPainter(global.painter)
	// Resume redraw of the SVG image
	suspendIds.map(([layer, suspendId]) => layer.unsuspendRedraw(suspendId))
}

show.pause = (paused, layers) => {
	if (paused) {
		pictureMode.start(layers)
	} else {
		pictureMode.stop()
	}	
}

on.load(() => trigger("resize"))

//================//
// CHANGE PAINTER //
//================//

const changePainter = (painter) => {
	global.painter.images.forEach((el) => {
		if (el.parentNode != null) {
			global.painterContainer.removeChild(el)
		}
	})
	global.painter = painter
	global.painter.images.forEach((el) => {
		el.style.visibility = "hidden"
		global.painterContainer.appendChild(el)
	})
	global.painter.images[global.painter.frame].style.visibility = "hidden"
}

// Run it once at the start to trigger the initial painter
changePainter(painters[0])

//=======//
// EVENT //
//=======//
on.contextmenu((e) => e.preventDefault(), {passive: false})

const KEYDOWN = {}
on.keydown(e => {
	const func = KEYDOWN[e.key]
	if (func === undefined) return
	func(e)
})

KEYDOWN["x"] = () => {
	const path = global.paths.pop()
	if (path) {
		path.element.remove()
	}
	if (global.painter.isPainting) {
		global.painter.isPainting = false
	}
}

KEYDOWN["r"] = () => {
	global.paths.forEach((path) => {
		path.element.remove()
	})
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
	changePainter(painters[global.painterId])
	e.preventDefault()
}
