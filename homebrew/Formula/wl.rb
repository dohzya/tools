class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/dz-skills"
  version "0.4.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/dz-skills/releases/download/wl-v0.4.0/wl-darwin-arm64"
      sha256 "df7e279da0be0f9ddcd3ee76338a9c9c4bd846e905e9d66c1e18ea5c895aff8c"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/dz-skills/releases/download/wl-v0.4.0/wl-darwin-x86_64"
      sha256 "ff8d308fbe48b740f560a97904f4fecd7b033ec3179ed689568af81550c529f8"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/dz-skills/releases/download/wl-v0.4.0/wl-linux-arm64"
      sha256 "b579c98b791c4e3021436499c6c2a37c27481110bf7d31d680a731d6d8e88bff"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/dz-skills/releases/download/wl-v0.4.0/wl-linux-x86_64"
      sha256 "a60364c50bf023faf8ef6d91166bfd36a3899db3753581085dd60d9f2b576f79"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "wl-darwin-arm64"
      else
        "wl-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "wl-linux-arm64"
      else
        "wl-linux-x86_64"
      end
    end

    bin.install binary_name => "wl"
  end

  test do
    system "#{bin}/wl", "--help"
  end
end
