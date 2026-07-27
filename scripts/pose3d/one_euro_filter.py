"""
One-Euro filter (Casiez et al. 2012) - adaptive low-pass filter that handles
both slow and fast motion without the lag/overshoot trade-off a fixed-cutoff
filter forces you into. Used here on every body keypoint and on the bat tip/
knob, per-axis, independently.

Why this over a fixed window (e.g. the moving-average / Savitzky-Golay combo
used in the MediaPipe-based pipeline): a swing has two very different motion
regimes in one clip - a near-static load/stance, then a fast downswing. A
fixed smoothing window that's gentle enough not to blur the fast swing is too
weak to clean up noise during the static phase, and one strong enough for the
static phase lags/blurs the swing. One-Euro adapts its cutoff frequency to the
signal's own speed each frame, which is exactly what this footage needs.
"""


class OneEuroFilter:
    def __init__(self, freq, mincutoff=1.0, beta=0.0, dcutoff=1.0):
        self.freq = freq
        self.mincutoff = mincutoff
        self.beta = beta
        self.dcutoff = dcutoff
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None

    @staticmethod
    def _alpha(cutoff, freq):
        te = 1.0 / freq
        tau = 1.0 / (2 * 3.14159265 * cutoff)
        return 1.0 / (1.0 + tau / te)

    def __call__(self, x, t=None):
        if self.t_prev is not None and t is not None:
            dt = max(t - self.t_prev, 1e-6)
            self.freq = 1.0 / dt
        self.t_prev = t

        if self.x_prev is None:
            self.x_prev = x
            return x

        dx = (x - self.x_prev) * self.freq
        a_d = self._alpha(self.dcutoff, self.freq)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev

        cutoff = self.mincutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff, self.freq)
        x_hat = a * x + (1 - a) * self.x_prev

        self.x_prev = x_hat
        self.dx_prev = dx_hat
        return x_hat


class PointFilter2D:
    """One-Euro filter applied independently to x and y of a 2D point stream."""

    def __init__(self, freq, mincutoff=1.0, beta=0.02, dcutoff=1.0):
        self.fx = OneEuroFilter(freq, mincutoff, beta, dcutoff)
        self.fy = OneEuroFilter(freq, mincutoff, beta, dcutoff)

    def __call__(self, x, y, t):
        return self.fx(x, t), self.fy(y, t)
