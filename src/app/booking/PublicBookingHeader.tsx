import { ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import styles from "./booking.module.css";

export default function PublicBookingHeader({ secureLink = false, quote = false }: { secureLink?: boolean; quote?: boolean }) {
  return (
    <header className={styles.publicHeader}>
      <Link className={styles.brand} href="/client-site" aria-label="Там где масло — на главную">
        <Image src="/brand/logo-wordmark-white.svg" width={204} height={30} priority alt="Там где масло." />
      </Link>
      <div className={styles.headerActions}>
        <Link href="/client-site">На сайт</Link>
        <ShieldCheck aria-hidden />
        <span>{secureLink ? "Защищённая ссылка" : quote ? "Расчёт стоимости" : "Онлайн-запись"}<br /><small>{secureLink ? "доступ только к этой записи" : quote ? "по вашему автомобилю" : "без звонка и регистрации"}</small></span>
      </div>
    </header>
  );
}
