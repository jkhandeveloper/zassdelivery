import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Password hashing, isolated behind one service so the algorithm and its
 * parameters can be tuned in a single place.
 *
 * Argon2id is used rather than bcrypt: it resists GPU and ASIC attacks through
 * memory hardness, which bcrypt's fixed 4 KB working set does not.
 */
@Injectable()
export class PasswordService {
  /**
   * OWASP's baseline for Argon2id (19 MiB, 2 iterations, 1 degree of
   * parallelism). Raising memory is the cheapest way to increase attacker cost
   * later; the encoded hash records its own parameters, so old hashes keep
   * verifying after a change.
   *
   * `raw` is pinned to false so `hash()` resolves to the string overload — the
   * Buffer overload would silently store binary in a VarChar column.
   */
  private readonly options: argon2.HashOptions & { raw?: false } = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    raw: false,
  };

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, this.options);
  }

  /**
   * Verifies a password. Returns false rather than throwing on a malformed
   * stored hash, so a corrupt row denies access instead of returning a 500 that
   * tells an attacker the account exists.
   */
  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      return false;
    }
  }

  /**
   * Whether a stored hash was produced with weaker parameters than the current
   * policy and should be re-hashed on the user's next successful login.
   */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, {
        memoryCost: this.options.memoryCost,
        timeCost: this.options.timeCost,
        parallelism: this.options.parallelism,
      });
    } catch {
      return true;
    }
  }
}
