export class Semaphore {
	private _locked = false;
	private _waiters: Array<(release: () => void) => void> = [];

	async acquire(timeoutMs?: number): Promise<() => void> {
		if (!this._locked) {
			this._locked = true;
			return this._release.bind(this);
		}

		return new Promise((resolve, reject) => {
			const waiter = resolve;

			const timer = timeoutMs
				? setTimeout(() => {
						const idx = this._waiters.indexOf(waiter);
						if (idx !== -1) this._waiters.splice(idx, 1);
						reject(new Error("Semaphore acquire timed out"));
					}, timeoutMs)
				: undefined;

			this._waiters.push((release) => {
				if (timer) clearTimeout(timer);
				resolve(release);
			});
		});
	}

	private _release() {
		const waiter = this._waiters.shift();
		if (waiter) {
			waiter(this._release.bind(this));
		} else {
			this._locked = false;
		}
	}
}
