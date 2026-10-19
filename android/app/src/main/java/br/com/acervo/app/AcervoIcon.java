package br.com.acervo.app;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;

/** Small original line icons shared by the native navigation and player. */
final class AcervoIcon extends Drawable {
    private final String kind;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

    AcervoIcon(String kind, int color) {
        this.kind = kind;
        paint.setColor(color);
        paint.setStrokeWidth(1.9f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
    }

    @Override public void draw(Canvas canvas) {
        canvas.save();
        canvas.translate(getBounds().left, getBounds().top);
        canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
        paint.setStyle(Paint.Style.STROKE);
        Path p = new Path();
        switch (kind) {
            case "home":
                p.moveTo(3, 10); p.lineTo(12, 3); p.lineTo(21, 10); p.lineTo(21, 21);
                p.lineTo(15, 21); p.lineTo(15, 14); p.lineTo(9, 14); p.lineTo(9, 21); p.lineTo(3, 21); p.close();
                canvas.drawPath(p, paint); break;
            case "search":
                canvas.drawCircle(10.5f, 10.5f, 6.5f, paint); canvas.drawLine(16, 16, 21, 21, paint); break;
            case "library":
                canvas.drawLine(4, 4, 4, 20, paint); canvas.drawLine(9, 4, 9, 20, paint);
                canvas.drawLine(14, 5, 20, 19, paint); break;
            case "radio":
                canvas.drawCircle(12, 12, 2, paint); canvas.drawArc(6, 6, 18, 18, 135, 90, false, paint);
                canvas.drawArc(6, 6, 18, 18, -45, 90, false, paint);
                canvas.drawArc(2, 2, 22, 22, 135, 90, false, paint);
                canvas.drawArc(2, 2, 22, 22, -45, 90, false, paint); break;
            case "play":
                paint.setStyle(Paint.Style.FILL); p.moveTo(8, 4); p.lineTo(21, 12); p.lineTo(8, 20); p.close();
                canvas.drawPath(p, paint); break;
            case "pause":
                paint.setStyle(Paint.Style.FILL); canvas.drawRoundRect(6, 4, 10, 20, 1, 1, paint);
                canvas.drawRoundRect(14, 4, 18, 20, 1, 1, paint); break;
            case "next": case "previous":
                if (kind.equals("previous")) { canvas.translate(24, 0); canvas.scale(-1, 1); }
                paint.setStyle(Paint.Style.FILL); p.moveTo(5, 5); p.lineTo(17, 12); p.lineTo(5, 19); p.close();
                canvas.drawPath(p, paint); canvas.drawRoundRect(18, 5, 20, 19, 1, 1, paint); break;
            case "more":
                paint.setStyle(Paint.Style.FILL); for (int x = 5; x <= 19; x += 7) canvas.drawCircle(x, 12, 1.5f, paint); break;
            case "download":
                canvas.drawLine(12, 3, 12, 15, paint); p.moveTo(7, 11); p.lineTo(12, 16); p.lineTo(17, 11);
                canvas.drawPath(p, paint); p.reset(); p.moveTo(4, 17); p.lineTo(4, 21); p.lineTo(20, 21); p.lineTo(20, 17);
                canvas.drawPath(p, paint); break;
            case "back":
                p.moveTo(14, 5); p.lineTo(7, 12); p.lineTo(14, 19); canvas.drawPath(p, paint); break;
            case "down":
                p.moveTo(5, 9); p.lineTo(12, 16); p.lineTo(19, 9); canvas.drawPath(p, paint); break;
            case "connect":
                canvas.drawRoundRect(3, 3, 15, 15, 1, 1, paint); canvas.drawLine(6, 19, 12, 19, paint);
                canvas.drawRoundRect(15, 9, 22, 22, 1, 1, paint); canvas.drawPoint(18.5f, 19, paint); break;
            case "update":
                canvas.drawArc(4, 4, 20, 20, -60, 290, false, paint);
                p.moveTo(20, 3); p.lineTo(20, 9); p.lineTo(14, 9); canvas.drawPath(p, paint); break;
            default:
                canvas.drawCircle(12, 12, 8, paint); canvas.drawLine(12, 7, 12, 13, paint);
                canvas.drawPoint(12, 17, paint);
        }
        canvas.restore();
    }

    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    @Override public int getIntrinsicWidth() { return 24; }
    @Override public int getIntrinsicHeight() { return 24; }
}
