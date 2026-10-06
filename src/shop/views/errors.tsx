// Error pages in the site design (UX Pilot "Error404" / "Error403"): the site menu stays, the card
// follows the person's accent color and theme.
import type { User } from "../../session";
import { Layout } from "./layout";

export function ErrorPage(props: { code: 404 | 403; user: User | null; message?: string }) {
  const lost = props.code === 404;
  const btn = "px-7 py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all w-full sm:w-auto";
  const link = (href: string, label: string) => (
    <a href={href} class="text-xs font-black text-muted hover:text-brand transition-colors">{label}</a>
  );
  return (
    <Layout title={lost ? "صفحه پیدا نشد" : "دسترسی محدود"} user={props.user} nav="home" bare wide>
      <div class="min-h-[75vh] flex items-center px-6 py-14">
        <div class={`relative w-full max-w-4xl mx-auto flex flex-col ${lost ? "md:flex-row" : "md:flex-row-reverse"} items-center gap-12`}>
          <div class="flex-1 flex justify-center">
            <div class={`relative ${lost ? "err-float" : "err-shake"}`}>
              {lost ? (
                <div class="w-60 h-60 md:w-72 md:h-72 bg-card rounded-[56px] shadow-2xl border-4 border-brand/10 relative overflow-hidden flex items-center justify-center">
                  <div class="absolute top-0 inset-x-0 h-2 bg-brand"></div>
                  <i class="fa-solid fa-magnifying-glass absolute text-[130px] text-brand/10 -rotate-12 translate-x-10 translate-y-6"></i>
                  <div class="relative text-center">
                    <span class="text-[96px] md:text-[110px] font-black text-brand leading-none">۴۰۴</span>
                    <div class="h-2 w-20 bg-brand/20 mx-auto rounded-full mt-3"></div>
                  </div>
                </div>
              ) : (
                <div class="w-60 h-60 md:w-72 md:h-72 bg-slate-900 rounded-[56px] shadow-2xl border-4 border-white/10 relative overflow-hidden flex items-center justify-center">
                  <div class="absolute inset-0 bg-gradient-to-br from-brand/25 to-transparent"></div>
                  <i class="fa-solid fa-lock-open absolute text-[130px] text-white/5 rotate-12 -translate-x-10 -translate-y-6"></i>
                  <div class="relative text-center">
                    <span class="text-[96px] md:text-[110px] font-black text-white leading-none">۴۰۳</span>
                    <div class="h-2 w-20 bg-brand mx-auto rounded-full mt-3"></div>
                  </div>
                </div>
              )}
              <div class={`absolute -top-5 ${lost ? "-right-5 bg-amber-400 -rotate-12" : "-left-5 bg-brand rotate-12"} w-14 h-14 rounded-3xl flex items-center justify-center text-white text-2xl shadow-xl`}>
                <i class={`fa-solid ${lost ? "fa-gift" : "fa-shield-halved"}`}></i>
              </div>
              <div class={`absolute -bottom-4 ${lost ? "-left-6 bg-slate-900 rotate-6" : "-right-6 bg-amber-400 -rotate-6"} w-16 h-16 rounded-3xl flex items-center justify-center text-white text-3xl shadow-xl`}>
                <i class={`fa-solid ${lost ? "fa-ghost" : "fa-key"}`}></i>
              </div>
            </div>
          </div>

          <div class="flex-1 text-center md:text-right space-y-7">
            <div class="space-y-4">
              <span class={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black ${lost ? "bg-brand/10 text-brand" : "bg-fg/5 text-fg"}`}>
                <i class={`fa-solid ${lost ? "fa-triangle-exclamation" : "fa-lock"}`}></i>
                {lost ? "صفحه گم شده است" : "دسترسی محدود شده"}
              </span>
              <h1 class="text-3xl md:text-4xl font-black text-fg leading-tight">
                {lost ? <>کادویی که دنبالش بودی،<br />اینجا نیست!</> : <>ورود به این بخش<br />مجاز نیست!</>}
              </h1>
              <p class="text-sm md:text-base font-bold text-muted leading-relaxed max-w-md mx-auto md:mr-0">
                {props.message ??
                  (lost
                    ? "متأسفانه صفحه‌ای که به دنبال آن هستید وجود ندارد یا به آدرس دیگری منتقل شده است."
                    : "شما اجازه دسترسی به این صفحه را ندارید. لطفاً از حساب کاربری خود مطمئن شوید یا با پشتیبانی تماس بگیرید.")}
              </p>
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-3 pt-2">
              {lost ? (
                <>
                  <a href="/" class={`${btn} bg-brand text-white shadow-xl shadow-brand/30 hover:scale-[1.03]`}><i class="fa-solid fa-house"></i>بازگشت به صفحه اصلی</a>
                  <a href="/" data-back="/" class={`${btn} bg-card text-fg border border-fg/10 hover:border-brand/40`}><i class="fa-solid fa-arrow-right"></i>صفحه قبلی</a>
                </>
              ) : (
                <>
                  {props.user ? (
                    <a href="/me" class={`${btn} bg-slate-900 text-white shadow-xl shadow-slate-900/30 hover:bg-brand`}><i class="fa-solid fa-user-gear"></i>حساب من</a>
                  ) : (
                    <a href="/login" rel="nofollow" class={`${btn} bg-slate-900 text-white shadow-xl shadow-slate-900/30 hover:bg-brand`}><i class="fa-solid fa-right-to-bracket"></i>ورود به حساب کاربری</a>
                  )}
                  <a href="/" class={`${btn} bg-card text-fg border border-fg/10 hover:border-brand/40`}><i class="fa-solid fa-house"></i>صفحه اصلی</a>
                </>
              )}
            </div>
            <div class="pt-6 flex flex-wrap justify-center md:justify-start gap-x-7 gap-y-3 border-t border-fg/10">
              {link("/about#contact", lost ? "تماس با پشتیبانی" : "گزارش مشکل")}
              {lost ? link("/#search", "جستجوی کادو") : link("/privacy", "حریم خصوصی و قوانین")}
              {link("/faq", "سوالات متداول")}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
