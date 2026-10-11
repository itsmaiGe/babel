package ui

import "testing"

func TestLayoutBoundsAcrossDPIAndNativeText(t *testing.T) {
	for _, dpi := range []int{96, 120, 144, 192} {
		for _, m := range []Metrics{
			{Line: 15, Heading: 21, Checkbox: 17, Note: 15, Status: 15, Version: 40},
			{Line: 30, Heading: 45, Control: 48, Button: 145, Redetect: 140, Checkbox: 62, Note: 90, Status: 90, Next: 28, Version: 95, IconW: 32, IconH: 32},
		} {
			layout := ComputeLayout(560, 440, m)
			w, h := layout.MinWidth, layout.MinHeight
			for id, r := range layout.Controls {
				if r.X < 0 || r.Y < 0 || r.W < 0 || r.H < 0 || r.X+r.W > w || r.Y+r.H > h {
					t.Fatalf("dpi=%d id=%d rect=%+v window=%dx%d", dpi, id, r, w, h)
				}
				left, right := (r.X*dpi+48)/96, ((r.X+r.W)*dpi+48)/96
				if right < left {
					t.Fatal("negative pixel width")
				}
			}
			if layout.Controls[110].Y+layout.Controls[110].H+11 != layout.Controls[111].Y {
				t.Fatal("details overlap footer")
			}
			if layout.Controls[101].X+layout.Controls[101].W+7 > layout.Controls[102].X {
				t.Fatal("heading overlaps version")
			}
			if layout.Controls[104].X+layout.Controls[104].W+7 > layout.Controls[105].X {
				t.Fatal("path overlaps redetect")
			}
			title, next, progress := layout.Controls[107], layout.Controls[116], layout.Controls[108]
			if next.Y != title.Y+title.H+3 {
				t.Fatalf("dpi=%d title/next gap title=%+v next=%+v", dpi, title, next)
			}
			wantNext := m.Next
			if wantNext < 0 {
				wantNext = 0
			}
			if next.H != wantNext {
				t.Fatalf("dpi=%d next height %+v want %d", dpi, next, wantNext)
			}
			bottom := next.Y + next.H
			if m.IconW > 0 {
				icon := layout.Controls[106]
				if title.X != icon.X+icon.W+7 {
					t.Fatalf("dpi=%d icon gap icon=%+v title=%+v", dpi, icon, title)
				}
				if icon.Y+icon.H > bottom {
					bottom = icon.Y + icon.H
				}
			}
			if progress.Y != bottom+7 {
				t.Fatalf("dpi=%d progress gap bottom=%d progress=%+v", dpi, bottom, progress)
			}
		}
	}
	collapsed := ComputeLayout(560, 440, Metrics{Next: -4, Status: 15, Line: 15})
	if collapsed.Controls[116].H != 0 {
		t.Fatalf("negative next height %+v", collapsed.Controls[116])
	}
}
