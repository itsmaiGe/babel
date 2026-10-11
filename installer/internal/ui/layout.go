package ui

type Rect struct{ X, Y, W, H int }
type Metrics struct{ Line, Heading, Control, Button, Redetect, Checkbox, Note, Status, Next, Version, IconW, IconH int }
type Layout struct {
	Controls            map[int]Rect
	MinWidth, MinHeight int
}

func max(values ...int) int {
	r := values[0]
	for _, v := range values[1:] {
		if v > r {
			r = v
		}
	}
	return r
}
func ComputeLayout(w, h int, m Metrics) Layout {
	m.Line = max(15, m.Line)
	m.Heading = max(21, m.Heading)
	m.Control = max(23, m.Line+8, m.Control)
	m.Button = max(75, m.Button)
	m.Redetect = max(75, m.Redetect)
	m.Checkbox = max(m.Line, m.Checkbox)
	m.Note = max(m.Line, m.Note)
	m.Status = max(m.Line, m.Status)
	if m.Next < 0 {
		m.Next = 0
	}
	minW := max(560, 3*m.Button+36, m.Redetect+189, m.Version+149)
	w = max(w, minW)
	c := map[int]Rect{}
	c[101] = Rect{11, 11, w - 29 - m.Version, m.Heading}
	c[102] = Rect{w - 11 - m.Version, 11 + (max(m.Heading, m.Line)-m.Line)/2, m.Version, m.Line}
	y := 11 + max(m.Heading, m.Line) + 11
	c[103] = Rect{11, y, w - 22, m.Line}
	y += m.Line + 5
	c[104] = Rect{11, y, w - 29 - m.Redetect, m.Control}
	c[105] = Rect{w - 11 - m.Redetect, y, m.Redetect, m.Control}
	y += m.Control + 11
	c[114] = Rect{11, y, w - 22, m.Checkbox}
	y += m.Checkbox + 3
	c[115] = Rect{11, y, w - 22, m.Note}
	y += m.Note + 11
	x := 11
	iconBottom := y
	if m.IconW > 0 {
		c[106] = Rect{11, y, m.IconW, m.IconH}
		x += m.IconW + 7
		iconBottom = y + m.IconH
	}
	c[107] = Rect{x, y, w - 11 - x, m.Status}
	nextY := y + m.Status + 3
	c[116] = Rect{x, nextY, w - 11 - x, m.Next}
	y = max(iconBottom, nextY+m.Next) + 7
	c[108] = Rect{11, y, w - 22, 15}
	y += 15 + 11
	c[109] = Rect{11, y, w - 22, m.Line}
	y += m.Line + 5
	minH := max(440, y+4*m.Line+8+22+m.Control)
	h = max(h, minH)
	fy := h - 11 - m.Control
	c[110] = Rect{11, y, w - 22, fy - 11 - y}
	c[111] = Rect{w - 11 - 3*m.Button - 14, fy, m.Button, m.Control}
	c[112] = Rect{w - 11 - 2*m.Button - 7, fy, m.Button, m.Control}
	c[113] = Rect{w - 11 - m.Button, fy, m.Button, m.Control}
	return Layout{c, minW, minH}
}
